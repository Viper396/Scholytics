from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from services import arxiv_client, summarizer

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
