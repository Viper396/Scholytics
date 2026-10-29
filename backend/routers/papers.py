from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from services import arxiv_client, comparer, summarizer
from services.metrics import metrics
from db.vector_store import canonicalize_arxiv_id

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
		try:
			paper = await asyncio.to_thread(arxiv_client.fetch_paper_by_id, arxiv_id)
		except Exception as exc:  # noqa: BLE001
			logger.error("arXiv metadata fetch failed for %s: %s", arxiv_id, exc)
			raise HTTPException(
				status_code=503,
				detail="arXiv metadata service is temporarily unavailable. Please try again later.",
			) from exc
		if paper is None:
			raise HTTPException(status_code=404, detail="Paper not found on arXiv.")
		title = str(paper.get("title", ""))
		abstract = str(paper.get("abstract", ""))
	else:
		paper = {"arxiv_id": arxiv_id, "title": title, "abstract": abstract}

	t_sum = time.perf_counter()
	try:
		summary = await asyncio.to_thread(
			summarizer.summarize_paper,
			title=title,
			abstract=abstract,
			arxiv_id=arxiv_id,
		)
		metrics.record_latency("groq_summary_ms", (time.perf_counter() - t_sum) * 1000.0)
	except Exception as exc:  # noqa: BLE001
		metrics.record_groq_failure("summary")
		logger.error("Summary generation failed for %s: %s", arxiv_id, exc)
		exc_str = str(exc).lower()
		exc_name = type(exc).__name__.lower()

		# 1. Missing Groq API key configuration
		if "not configured" in exc_str or "groq_api_key is not configured" in exc_str:
			raise HTTPException(
				status_code=503,
				detail="LLM summarization is currently unconfigured. Set GROQ_API_KEY in the environment.",
			) from exc

		# 2. Authentication failure (invalid API key)
		if "invalid_api_key" in exc_str or "authentication" in exc_name or "401" in exc_str:
			raise HTTPException(
				status_code=502,
				detail="Groq authentication failed: Invalid GROQ_API_KEY. Please verify your API key in environment settings.",
			) from exc

		# 3. Rate limits
		if "ratelimit" in exc_name or "429" in exc_str or "rate limit" in exc_str:
			raise HTTPException(
				status_code=429,
				detail="Groq rate limit reached. Please wait a moment before requesting another summary.",
			) from exc

		# 4. Unavailable or decommissioned model
		if (
			"model_not_found" in exc_str
			or "notfounderror" in exc_name
			or "does not exist" in exc_str
			or "decommissioned" in exc_str
			or ("404" in exc_str and "model" in exc_str)
		):
			raise HTTPException(
				status_code=502,
				detail="Configured summarization model is unavailable or decommissioned on Groq. Please verify GROQ_MODEL in environment settings.",
			) from exc

		# 5. Upstream outage, network failure, or timeout
		if (
			"connection" in exc_str
			or "connection" in exc_name
			or "timeout" in exc_str
			or "timeout" in exc_name
			or "connecterror" in exc_str
			or "timed out" in exc_str
			or "503" in exc_str
			or "500" in exc_str
			or "internalservererror" in exc_name
		):
			raise HTTPException(
				status_code=503,
				detail="Groq summarization service is temporarily unavailable. Please try again later.",
			) from exc

		# 6. Fallback safe error
		raise HTTPException(
			status_code=502,
			detail="Upstream summarization service failed. Please try again later.",
		) from exc

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

	# 1. Use client-provided paper metadata if supplied (match by raw or canonical ID)
	if payload.papers:
		id_set = {canonicalize_arxiv_id(aid) for aid in payload.arxiv_ids}
		for p in payload.papers:
			raw_pid = str(p.get("arxiv_id", "")).strip()
			if raw_pid and canonicalize_arxiv_id(raw_pid) in id_set:
				papers.append(p)

	# 2. Fetch any missing papers from arXiv
	present_ids = {canonicalize_arxiv_id(str(p.get("arxiv_id", "")).strip()) for p in papers}
	missing_ids = [aid for aid in payload.arxiv_ids if canonicalize_arxiv_id(aid) not in present_ids]

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

	# Preserve requested order, resolving by raw or canonical ID
	papers_by_id: dict[str, dict[str, Any]] = {}
	for p in papers:
		raw_pid = str(p.get("arxiv_id", "")).strip()
		papers_by_id[raw_pid] = p
		papers_by_id[canonicalize_arxiv_id(raw_pid)] = p

	ordered_papers: list[dict[str, Any]] = []
	for aid in payload.arxiv_ids:
		paper = papers_by_id.get(aid) or papers_by_id.get(canonicalize_arxiv_id(aid))
		if paper and paper not in ordered_papers:
			ordered_papers.append(paper)

	if len(ordered_papers) < 2:
		raise HTTPException(
			status_code=404,
			detail="Could not match at least 2 valid papers for comparison.",
		)

	t_cmp = time.perf_counter()
	try:
		comparison = await asyncio.to_thread(
			comparer.compare_papers,
			papers=ordered_papers,
			query=payload.query,
		)
		metrics.record_latency("groq_compare_ms", (time.perf_counter() - t_cmp) * 1000.0)
		return comparison
	except Exception as exc:  # noqa: BLE001
		metrics.record_groq_failure("compare")
		logger.error("Paper comparison failed: %s", exc)
		exc_str = str(exc).lower()
		exc_name = type(exc).__name__.lower()

		if "not configured" in exc_str or "groq_api_key is not configured" in exc_str:
			raise HTTPException(
				status_code=503,
				detail="LLM paper comparison is currently unconfigured. Set GROQ_API_KEY in the environment.",
			) from exc
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
		if "model_not_found" in exc_str or "does not exist" in exc_str or "decommissioned" in exc_str:
			raise HTTPException(
				status_code=502,
				detail="Configured model is unavailable or decommissioned on Groq. Please verify GROQ_MODEL in environment settings.",
			) from exc
		raise HTTPException(
			status_code=500,
			detail="Failed to generate comparison. Please check server logs and try again.",
		) from exc
