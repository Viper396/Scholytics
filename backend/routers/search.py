from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from db.chroma_client import get_collection
from services import arxiv_client, embedder, summarizer

logger = logging.getLogger(__name__)

router = APIRouter(tags=["search"])

# Supported arXiv categories — callers may not submit arbitrary strings.
_VALID_CATEGORIES = frozenset(
	{
		"cs.AI", "cs.AR", "cs.CC", "cs.CE", "cs.CG", "cs.CL", "cs.CR",
		"cs.CV", "cs.CY", "cs.DB", "cs.DC", "cs.DL", "cs.DM", "cs.DS",
		"cs.ET", "cs.FL", "cs.GL", "cs.GR", "cs.GT", "cs.HC", "cs.IR",
		"cs.IT", "cs.LG", "cs.LO", "cs.MA", "cs.MM", "cs.MS", "cs.NA",
		"cs.NE", "cs.NI", "cs.OH", "cs.OS", "cs.PF", "cs.PL", "cs.RO",
		"cs.SC", "cs.SD", "cs.SE", "cs.SI", "cs.SY",
		"eess.AS", "eess.IV", "eess.SP", "eess.SY",
		"math.ST", "stat.AP", "stat.CO", "stat.ME", "stat.ML", "stat.OT", "stat.TH",
		"physics.data-an",
	}
)

_ARXIV_ID_PATTERN = re.compile(r"^\d{4}\.\d{4,5}(v\d+)?$")
_MAX_QUERY_LEN = 400
_MAX_ARXIV_IDS = 25


def _validate_arxiv_id(arxiv_id: str) -> str:
	cleaned = arxiv_id.strip()
	if not _ARXIV_ID_PATTERN.match(cleaned):
		raise ValueError(f"Invalid arXiv ID format: {arxiv_id!r}")
	return cleaned


class SearchFilters(BaseModel):
	date_from: str | None = None
	categories: list[str] | None = None

	@field_validator("categories")
	@classmethod
	def validate_categories(cls, value: list[str] | None) -> list[str] | None:
		if value is None:
			return value
		invalid = [c for c in value if c not in _VALID_CATEGORIES]
		if invalid:
			raise ValueError(f"Unsupported categories: {invalid}. Supported: {sorted(_VALID_CATEGORIES)}")
		return value

	@field_validator("date_from")
	@classmethod
	def validate_date_from(cls, value: str | None) -> str | None:
		if value is None:
			return value
		try:
			datetime.strptime(value, "%Y-%m-%d")
		except ValueError:
			raise ValueError("date_from must be in YYYY-MM-DD format")
		return value


class SearchRequest(BaseModel):
	query: str = Field(..., min_length=1, max_length=_MAX_QUERY_LEN)
	max_results: int = Field(default=10, ge=1, le=25)
	filters: SearchFilters | None = None


class SearchSynthesizeRequest(BaseModel):
	query: str = Field(..., min_length=1, max_length=_MAX_QUERY_LEN)
	arxiv_ids: list[str] = Field(..., min_length=1, max_length=_MAX_ARXIV_IDS)
	# Optional: pass paper metadata so we can skip re-fetching from arXiv.
	papers: list[dict[str, Any]] | None = None

	@field_validator("arxiv_ids")
	@classmethod
	def validate_ids(cls, value: list[str]) -> list[str]:
		validated = []
		seen: set[str] = set()
		for raw_id in value:
			cleaned = raw_id.strip()
			if not _ARXIV_ID_PATTERN.match(cleaned):
				raise ValueError(f"Invalid arXiv ID format: {raw_id!r}")
			if cleaned not in seen:
				validated.append(cleaned)
				seen.add(cleaned)
		return validated


def _split_csv(value: Any) -> list[str]:
	if isinstance(value, list):
		return [str(item) for item in value]
	if not value:
		return []
	return [part.strip() for part in str(value).split(",") if part.strip()]


@router.post("/api/search")
async def search(payload: SearchRequest, request: Request) -> dict[str, Any]:
	query = payload.query.strip()

	filters_dict: dict[str, Any] | None = None
	if payload.filters is not None:
		if hasattr(payload.filters, "model_dump"):
			filters_dict = payload.filters.model_dump(exclude_none=True)
		else:
			filters_dict = payload.filters.dict(exclude_none=True)

		# Additional date range sanity check (date_from can't be in the future)
		date_from = filters_dict.get("date_from")
		if date_from:
			try:
				from_date = datetime.strptime(date_from, "%Y-%m-%d")
				if from_date.year > datetime.now().year:
					raise HTTPException(status_code=422, detail="filters.date_from cannot be in the future")
			except ValueError as exc:
				raise HTTPException(status_code=422, detail="filters.date_from must be YYYY-MM-DD") from exc

	try:
		papers = await asyncio.to_thread(
			arxiv_client.search_papers,
			query=query,
			max_results=payload.max_results,
			filters=filters_dict,
		)
	except RuntimeError as exc:
		logger.error("arXiv search upstream failure for query %r: %s", query, exc)
		raise HTTPException(status_code=503, detail="arXiv search is currently unavailable. Please try again.") from exc
	except Exception as exc:  # noqa: BLE001
		logger.error("Unexpected search error for query %r: %s", query, exc)
		raise HTTPException(status_code=500, detail="Search pipeline failed") from exc

	if not papers:
		return {"query": query, "results": [], "total": 0}

	collection = get_collection()
	if collection is None:
		raise HTTPException(status_code=500, detail="Vector store is unavailable")

	try:
		embedder.index_papers(papers, collection)
	except RuntimeError as exc:
		# Embedding model is unavailable — return unranked results with a warning.
		logger.warning("Embedding unavailable, returning unranked results: %s", exc)
		return {
			"query": query,
			"results": [
				{
					"arxiv_id": str(p.get("arxiv_id", "")),
					"title": str(p.get("title", "")),
					"authors": p.get("authors", []),
					"abstract": str(p.get("abstract", "")),
					"published": str(p.get("published", "")),
					"categories": p.get("categories", []),
					"pdf_url": str(p.get("pdf_url", "")),
					"entry_url": str(p.get("entry_url", "")),
					"relevance_score": None,
					"ranking_degraded": True,
				}
				for p in papers
			],
			"total": len(papers),
			"ranking_note": "Results are unranked because the semantic embedding model is unavailable.",
		}

	try:
		query_vector = embedder.embed_query(query)
	except RuntimeError as exc:
		logger.warning("Query embedding unavailable, returning unranked results: %s", exc)
		return {
			"query": query,
			"results": [
				{
					"arxiv_id": str(p.get("arxiv_id", "")),
					"title": str(p.get("title", "")),
					"authors": p.get("authors", []),
					"abstract": str(p.get("abstract", "")),
					"published": str(p.get("published", "")),
					"categories": p.get("categories", []),
					"pdf_url": str(p.get("pdf_url", "")),
					"entry_url": str(p.get("entry_url", "")),
					"relevance_score": None,
					"ranking_degraded": True,
				}
				for p in papers
			],
			"total": len(papers),
			"ranking_note": "Results are unranked because the semantic embedding model is unavailable.",
		}

	fetched_ids = [str(paper.get("arxiv_id")) for paper in papers if paper.get("arxiv_id")]

	if not fetched_ids:
		return {"query": query, "results": [], "total": 0}

	try:
		query_result = collection.query(
			query_embeddings=[query_vector],
			n_results=min(payload.max_results, len(fetched_ids)),
			where={"arxiv_id": {"$in": fetched_ids}},
			include=["metadatas", "documents", "distances"],
		)
	except Exception as exc:  # noqa: BLE001
		logger.error("ChromaDB query failed: %s", exc)
		raise HTTPException(status_code=500, detail="Search pipeline failed") from exc

	ids = (query_result.get("ids") or [[]])[0]
	distances = (query_result.get("distances") or [[]])[0]
	metadatas = (query_result.get("metadatas") or [[]])[0]
	documents = (query_result.get("documents") or [[]])[0]

	papers_by_id = {
		str(paper.get("arxiv_id")): paper
		for paper in papers
		if paper.get("arxiv_id")
	}

	# Note: relevance_score = 1 - cosine_distance (ChromaDB cosine space).
	# This is not a probability but a cosine similarity value in [0, 1] for
	# normalized vectors. It reflects semantic similarity to the query.
	is_degraded = embedder.is_using_hash_fallback()
	results: list[dict[str, Any]] = []
	for idx, paper_id in enumerate(ids):
		distance = float(distances[idx]) if idx < len(distances) and distances[idx] is not None else 1.0
		relevance_score = max(0.0, min(1.0, 1.0 - distance))
		metadata = metadatas[idx] if idx < len(metadatas) and metadatas[idx] else {}
		document = documents[idx] if idx < len(documents) else ""

		source_paper = papers_by_id.get(str(paper_id), {})
		result = {
			"arxiv_id": str(source_paper.get("arxiv_id") or metadata.get("arxiv_id") or paper_id),
			"title": str(source_paper.get("title") or metadata.get("title") or ""),
			"authors": source_paper.get("authors") or _split_csv(metadata.get("authors")),
			"abstract": str(source_paper.get("abstract") or document),
			"published": str(source_paper.get("published") or metadata.get("published") or ""),
			"categories": source_paper.get("categories") or _split_csv(metadata.get("categories")),
			"pdf_url": str(source_paper.get("pdf_url") or metadata.get("pdf_url") or ""),
			"entry_url": str(source_paper.get("entry_url") or metadata.get("entry_url") or ""),
			"relevance_score": relevance_score,
			"ranking_degraded": is_degraded,
		}
		results.append(result)

	results.sort(key=lambda item: item["relevance_score"] or 0.0, reverse=True)

	response: dict[str, Any] = {"query": query, "results": results, "total": len(results)}
	if is_degraded:
		response["ranking_note"] = (
			"Ranking uses hash-based embeddings (development fallback). "
			"Results do not reflect genuine semantic similarity."
		)
	return response


@router.post("/api/search/synthesize")
async def synthesize_search(payload: SearchSynthesizeRequest) -> StreamingResponse:
	query = payload.query.strip()

	arxiv_ids = payload.arxiv_ids  # already validated and deduplicated

	# If the caller passed paper metadata, use it directly to avoid re-fetching.
	# Otherwise fall back to fetching from arXiv.
	papers: list[dict[str, Any]] = []

	if payload.papers:
		# Validate that the supplied paper IDs are a subset of the requested IDs.
		id_set = set(arxiv_ids)
		for paper in payload.papers:
			pid = str(paper.get("arxiv_id", "")).strip()
			if pid and pid in id_set:
				papers.append(paper)

	if not papers:
		# Fetch from arXiv; limit concurrency to avoid hammering the API.
		sem = asyncio.Semaphore(5)

		async def bounded_fetch(aid: str) -> dict[str, Any] | None:
			async with sem:
				return await asyncio.to_thread(arxiv_client.fetch_paper_by_id, aid)

		fetch_tasks = [bounded_fetch(arxiv_id) for arxiv_id in arxiv_ids]
		fetched_results = await asyncio.gather(*fetch_tasks, return_exceptions=True)

		for fetched in fetched_results:
			if isinstance(fetched, BaseException):
				continue
			if isinstance(fetched, dict):
				papers.append(fetched)

	if not papers:
		raise HTTPException(status_code=404, detail="No papers found for the provided arXiv IDs")

	def event_stream():
		try:
			for token in summarizer.generate_search_summary(query, papers):
				# Each token may contain newlines; emit each non-empty line separately.
				# SSE event format: each "event" is terminated by a blank line (\n\n).
				# A single token (possibly multi-line) is emitted as one SSE event
				# with one data: field per line, all grouped before the blank line.
				lines = token.splitlines() if token else []
				if not lines:
					lines = [""]
				data_lines = "\n".join(f"data: {line}" for line in lines)
				yield f"{data_lines}\n\n"
		except Exception as exc:  # noqa: BLE001
			logger.error("Synthesis stream error: %s", exc)
			yield "event: error\ndata: Synthesis unavailable.\n\n"
			return

		yield "event: done\ndata: [DONE]\n\n"

	return StreamingResponse(event_stream(), media_type="text/event-stream")
