"""
Ingestion router for explicit, bounded indexing and corpus maintenance.

Provides endpoints to:
1. Trigger incremental paper ingestion by query topic or explicit arXiv IDs.
2. Inspect corpus size and vector store index status.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from services import arxiv_client, ingestion

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ingest", tags=["ingestion"])

_ARXIV_ID_PATTERN = re.compile(r"^\d{4}\.\d{4,5}(v\d+)?$")
_MAX_BATCH_PAPERS = 25


class IngestRequest(BaseModel):
	query: str | None = Field(default=None, max_length=200)
	arxiv_ids: list[str] | None = Field(default=None, max_length=_MAX_BATCH_PAPERS)
	max_papers: int = Field(default=10, ge=1, le=_MAX_BATCH_PAPERS)
	categories: list[str] | None = None


@router.get("/status")
async def get_ingest_status(request: Request) -> dict[str, Any]:
	"""Return status and vector count of the active vector store index."""
	vector_store = getattr(request.app.state, "vector_store", None)
	if vector_store is None:
		raise HTTPException(status_code=503, detail="Vector store is not initialized")

	try:
		count = vector_store.count()
		backend_name = vector_store.__class__.__name__
		return {
			"status": "ready",
			"backend": backend_name,
			"total_indexed_papers": count,
		}
	except Exception as exc:  # noqa: BLE001
		logger.error("Failed to query vector store status: %s", exc)
		raise HTTPException(status_code=500, detail="Failed to retrieve index status") from exc


@router.post("")
async def trigger_ingestion(payload: IngestRequest, request: Request) -> dict[str, Any]:
	"""
	Trigger incremental, bounded ingestion of papers into the persistent index.

	Supports either:
	- Topic discovery: search arXiv by query/categories and ingest new papers.
	- Explicit IDs: fetch papers by arXiv ID and ingest new papers.
	"""
	if not payload.query and not payload.arxiv_ids:
		raise HTTPException(
			status_code=422,
			detail="Either 'query' or 'arxiv_ids' must be provided for ingestion",
		)

	vector_store = getattr(request.app.state, "vector_store", None)
	if vector_store is None:
		raise HTTPException(status_code=503, detail="Vector store is not initialized")

	candidate_papers: list[dict[str, Any]] = []

	# Case 1: Fetch by explicit arXiv IDs
	if payload.arxiv_ids:
		sem = asyncio.Semaphore(5)

		async def fetch_one(aid: str) -> dict[str, Any] | None:
			cleaned = aid.strip()
			if not _ARXIV_ID_PATTERN.match(cleaned):
				return None
			async with sem:
				return await asyncio.to_thread(arxiv_client.fetch_paper_by_id, cleaned)

		tasks = [fetch_one(aid) for aid in payload.arxiv_ids]
		fetched = await asyncio.gather(*tasks, return_exceptions=True)
		for item in fetched:
			if isinstance(item, dict):
				candidate_papers.append(item)

	# Case 2: Discover via arXiv search
	elif payload.query:
		filters = {"categories": payload.categories} if payload.categories else None
		try:
			candidate_papers = await asyncio.to_thread(
				arxiv_client.search_papers,
				query=payload.query.strip(),
				max_results=payload.max_papers,
				filters=filters,
			)
		except Exception as exc:  # noqa: BLE001
			logger.error("arXiv discovery failed during ingestion: %s", exc)
			raise HTTPException(status_code=503, detail="arXiv search is currently unavailable") from exc

	if not candidate_papers:
		return {
			"status": "completed",
			"message": "No candidate papers found",
			"stats": {
				"discovered": 0,
				"already_indexed": 0,
				"newly_indexed": 0,
				"in_flight_skipped": 0,
				"failed": 0,
			},
			"total_indexed_papers": vector_store.count(),
		}

	# Run ingestion pass
	stats = await ingestion.ingest_candidates(
		papers=candidate_papers,
		vector_store=vector_store,
		max_batch=payload.max_papers,
	)

	return {
		"status": "completed",
		"stats": {
			"discovered": stats.discovered,
			"already_indexed": stats.already_indexed,
			"newly_indexed": stats.newly_indexed,
			"in_flight_skipped": stats.in_flight_skipped,
			"failed": stats.failed,
		},
		"total_indexed_papers": vector_store.count(),
	}
