from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from services import arxiv_client, comparer, summarizer
from services.cache import (
	async_single_flight,
	build_compare_cache_key,
	build_summary_cache_key,
	paper_comparison_cache,
	paper_summary_cache,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["papers"])

_ARXIV_ID_PATTERN = re.compile(r"^\d{4}\.\d{4,5}(v\d+)?$")
_MAX_BATCH_SIZE = 10


def _validate_arxiv_id_format(arxiv_id: str) -> str:
	cleaned = arxiv_id.strip()
	if not _ARXIV_ID_PATTERN.match(cleaned):
		raise ValueError(f"Invalid arXiv ID format: {arxiv_id!r}")
	return cleaned


class SummarizePaperRequest(BaseModel):
	title: str | None = None
	abstract: str | None = None


class SummarizeBatchRequest(BaseModel):
	arxiv_ids: list[str] = Field(..., min_length=1, max_length=_MAX_BATCH_SIZE)

	@field_validator("arxiv_ids")
	@classmethod
	def validate_ids(cls, value: list[str]) -> list[str]:
		validated = []
		seen: set[str] = set()
		for raw_id in value:
			cleaned = _validate_arxiv_id_format(raw_id)
			if cleaned not in seen:
				validated.append(cleaned)
				seen.add(cleaned)
		return validated


class ComparePapersRequest(BaseModel):
	arxiv_ids: list[str] = Field(..., min_length=2, max_length=4)
	papers: list[dict[str, Any]] | None = None
	query: str | None = None

	@field_validator("arxiv_ids")
	@classmethod
	def validate_compare_ids(cls, value: list[str]) -> list[str]:
		validated = []
		seen: set[str] = set()
		for raw_id in value:
			cleaned = _validate_arxiv_id_format(raw_id)
			if cleaned not in seen:
				validated.append(cleaned)
				seen.add(cleaned)
		if len(validated) < 2:
			raise ValueError("At least 2 unique arXiv IDs are required for comparison")
		return validated[:4]


@router.get("/api/papers/{arxiv_id}")
async def get_paper(arxiv_id: str) -> dict[str, Any]:
	try:
		_validate_arxiv_id_format(arxiv_id)
	except ValueError as exc:
		raise HTTPException(status_code=422, detail=str(exc)) from exc

	paper = await asyncio.to_thread(arxiv_client.fetch_paper_by_id, arxiv_id)
	if paper is None:
		raise HTTPException(status_code=404, detail="Paper not found")
	return paper


@router.post("/api/papers/{arxiv_id}/summarize")
async def summarize_paper(
	arxiv_id: str,
	payload: SummarizePaperRequest | None = None,
) -> dict[str, str]:
	try:
		_validate_arxiv_id_format(arxiv_id)
	except ValueError as exc:
		raise HTTPException(status_code=422, detail=str(exc)) from exc

	title = payload.title.strip() if payload and payload.title else None
	abstract = payload.abstract.strip() if payload and payload.abstract else None

	if not title or not abstract:
		paper = await asyncio.to_thread(arxiv_client.fetch_paper_by_id, arxiv_id)
		if paper is None:
			raise HTTPException(status_code=404, detail="Paper not found")
		title = str(paper.get("title", ""))
		abstract = str(paper.get("abstract", ""))
	else:
		paper = {"arxiv_id": arxiv_id, "title": title, "abstract": abstract}

	try:
		summary = await asyncio.to_thread(
			summarizer.summarize_paper,
			title=title,
			abstract=abstract,
			arxiv_id=arxiv_id,
		)
	except Exception as exc:  # noqa: BLE001
		logger.error("Summary generation failed for %s: %s", arxiv_id, exc)
		exc_str = str(exc)
		exc_name = type(exc).__name__.lower()
		if "invalid_api_key" in exc_str.lower() or "authentication" in exc_name or "401" in exc_str:
			detail = "Groq authentication failed: Invalid GROQ_API_KEY. Please verify your API key at console.groq.com and in Render."
		elif "ratelimit" in exc_name or "429" in exc_str:
			detail = "Groq rate limit reached. Please wait a moment before requesting another summary."
		else:
			detail = "Failed to summarize paper"
		raise HTTPException(status_code=500, detail=detail) from exc

	return {"arxiv_id": str(paper.get("arxiv_id", arxiv_id)), "summary": summary}


@router.post("/api/papers/summarize-batch")
async def summarize_batch(payload: SummarizeBatchRequest) -> dict[str, list[dict[str, str]]]:
	arxiv_ids = payload.arxiv_ids  # already validated and deduplicated

	# Fetch papers concurrently with bounded concurrency.
	sem = asyncio.Semaphore(5)

	async def bounded_fetch(aid: str) -> dict[str, Any] | None:
		async with sem:
			return await asyncio.to_thread(arxiv_client.fetch_paper_by_id, aid)

	fetch_tasks = [bounded_fetch(aid) for aid in arxiv_ids]
	fetched = await asyncio.gather(*fetch_tasks, return_exceptions=True)

	fetched_papers: list[dict[str, Any]] = []
	for result in fetched:
		if isinstance(result, BaseException):
			logger.warning("Batch fetch exception: %s", result)
			continue
		if isinstance(result, dict):
			fetched_papers.append(result)

	if not fetched_papers:
		return {"papers": []}

	# Summarize sequentially to avoid overwhelming Groq rate limits.
	summarized = await asyncio.to_thread(summarizer.summarize_multiple, fetched_papers)
	papers_response = [
		{
			"arxiv_id": str(paper.get("arxiv_id", "")),
			"title": str(paper.get("title", "")),
			"summary": str(paper.get("summary", "Summary unavailable.")),
		}
		for paper in summarized
	]

	return {"papers": papers_response}


@router.post("/api/papers/compare", response_model=comparer.ComparisonResult)
async def compare_papers_endpoint(payload: ComparePapersRequest) -> comparer.ComparisonResult:
	"""
	Generate a structured comparison for 2 to 4 papers with validated fields and authentic links.
	"""
	papers: list[dict[str, Any]] = []

	# 1. Use client-provided paper metadata if supplied
	if payload.papers:
		id_set = set(payload.arxiv_ids)
		for p in payload.papers:
			pid = str(p.get("arxiv_id", "")).strip()
			if pid and pid in id_set:
				papers.append(p)

	# 2. Fetch any missing papers from arXiv
	present_ids = {str(p.get("arxiv_id", "")).strip() for p in papers}
	missing_ids = [aid for aid in payload.arxiv_ids if aid not in present_ids]

	if missing_ids:
		sem = asyncio.Semaphore(4)

		async def fetch_one(aid: str) -> dict[str, Any] | None:
			async with sem:
				return await asyncio.to_thread(arxiv_client.fetch_paper_by_id, aid)

		tasks = [fetch_one(aid) for aid in missing_ids]
		fetched = await asyncio.gather(*tasks, return_exceptions=True)
		for res in fetched:
			if isinstance(res, dict):
				papers.append(res)

	if len(papers) < 2:
		raise HTTPException(
			status_code=404,
			detail="Could not retrieve at least 2 valid papers for comparison.",
		)

	# Preserve requested order
	papers_by_id = {str(p.get("arxiv_id", "")).strip(): p for p in papers}
	ordered_papers = [papers_by_id[aid] for aid in payload.arxiv_ids if aid in papers_by_id]

	try:
		comparison = await asyncio.to_thread(
			comparer.compare_papers,
			papers=ordered_papers,
			query=payload.query,
		)
		return comparison
	except Exception as exc:  # noqa: BLE001
		logger.error("Paper comparison failed: %s", exc)
		exc_str = str(exc)
		exc_name = type(exc).__name__.lower()
		if "401" in exc_str or "authentication" in exc_name or "invalid_api_key" in exc_str:
			raise HTTPException(
				status_code=502,
				detail="Groq authentication failed: Invalid GROQ_API_KEY. Please verify your API key in Render.",
			) from exc
		if "429" in exc_str or "ratelimit" in exc_name:
			raise HTTPException(
				status_code=429,
				detail="Groq rate limit reached. Please wait a moment before requesting comparison.",
			) from exc
		raise HTTPException(
			status_code=500,
			detail=f"Failed to generate comparison: {exc_str}",
		) from exc
