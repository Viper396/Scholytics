from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from db.chroma_client import get_collection
from services import arxiv_client, embedder, summarizer

router = APIRouter(tags=["search"])


class SearchFilters(BaseModel):
	date_from: str | None = None
	categories: list[str] | None = None


class SearchRequest(BaseModel):
	query: str
	max_results: int = Field(default=10, ge=1, le=25)
	filters: SearchFilters | None = None


class SearchSynthesizeRequest(BaseModel):
	query: str
	arxiv_ids: list[str]


def _split_csv(value: Any) -> list[str]:
	if isinstance(value, list):
		return [str(item) for item in value]
	if not value:
		return []
	return [part.strip() for part in str(value).split(",") if part.strip()]


@router.post("/api/search")
async def search(payload: SearchRequest) -> dict[str, Any]:
	query = payload.query.strip()
	if not query:
		raise HTTPException(status_code=422, detail="query must be a non-empty string")

	filters_dict: dict[str, Any] | None = None
	if payload.filters is not None:
		if hasattr(payload.filters, "model_dump"):
			filters_dict = payload.filters.model_dump(exclude_none=True)
		else:
			filters_dict = payload.filters.dict(exclude_none=True)
		date_from = filters_dict.get("date_from")
		if date_from:
			try:
				datetime.strptime(str(date_from), "%Y-%m-%d")
			except ValueError as exc:
				raise HTTPException(status_code=422, detail="filters.date_from must be YYYY-MM-DD") from exc

	try:
		papers = arxiv_client.search_papers(
			query=query,
			max_results=payload.max_results,
			filters=filters_dict,
		)

		if not papers:
			return {"query": query, "results": [], "total": 0}

		collection = get_collection()
		if collection is None:
			raise HTTPException(status_code=500, detail="Vector store is unavailable")
		embedder.index_papers(papers, collection)

		query_vector = embedder.embed_query(query)
		fetched_ids = [str(paper.get("arxiv_id")) for paper in papers if paper.get("arxiv_id")]

		if not fetched_ids:
			return {"query": query, "results": [], "total": 0}

		query_result = collection.query(
			query_embeddings=[query_vector],
			n_results=min(payload.max_results, len(fetched_ids)),
			where={"arxiv_id": {"$in": fetched_ids}},
			include=["metadatas", "documents", "distances"],
		)

		ids = (query_result.get("ids") or [[]])[0]
		distances = (query_result.get("distances") or [[]])[0]
		metadatas = (query_result.get("metadatas") or [[]])[0]
		documents = (query_result.get("documents") or [[]])[0]

		papers_by_id = {
			str(paper.get("arxiv_id")): paper
			for paper in papers
			if paper.get("arxiv_id")
		}

		results: list[dict[str, Any]] = []
		for idx, paper_id in enumerate(ids):
			distance = float(distances[idx]) if idx < len(distances) and distances[idx] is not None else 1.0
			relevance_score = 1.0 - distance
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
			}
			results.append(result)

		results.sort(key=lambda item: item["relevance_score"], reverse=True)

		return {"query": query, "results": results, "total": len(results)}
	except HTTPException:
		raise
	except Exception as exc:
		raise HTTPException(status_code=500, detail="Search pipeline failed") from exc


@router.post("/api/search/synthesize")
async def synthesize_search(payload: SearchSynthesizeRequest) -> StreamingResponse:
	query = payload.query.strip()
	if not query:
		raise HTTPException(status_code=422, detail="query must be a non-empty string")

	arxiv_ids = [arxiv_id.strip() for arxiv_id in payload.arxiv_ids if arxiv_id.strip()]
	if not arxiv_ids:
		raise HTTPException(status_code=422, detail="arxiv_ids must contain at least one ID")

	fetch_tasks = [
		asyncio.to_thread(arxiv_client.fetch_paper_by_id, arxiv_id)
		for arxiv_id in arxiv_ids
	]
	fetched_results = await asyncio.gather(*fetch_tasks, return_exceptions=True)

	papers: list[dict[str, Any]] = []
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
				lines = token.splitlines() or [""]
				for line in lines:
					yield f"data: {line}\n"
				yield "\n"
		except Exception:
			yield "event: error\ndata: Synthesis unavailable.\n\n"
			return

		yield "event: done\ndata: [DONE]\n\n"

	return StreamingResponse(event_stream(), media_type="text/event-stream")
