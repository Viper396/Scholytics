from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import arxiv_client, summarizer

router = APIRouter(tags=["papers"])


class SummarizeBatchRequest(BaseModel):
	arxiv_ids: list[str]


@router.get("/api/papers/{arxiv_id}")
async def get_paper(arxiv_id: str) -> dict[str, Any]:
	paper = arxiv_client.fetch_paper_by_id(arxiv_id)
	if paper is None:
		raise HTTPException(status_code=404, detail="Paper not found")
	return paper


@router.post("/api/papers/{arxiv_id}/summarize")
async def summarize_paper(arxiv_id: str) -> dict[str, str]:
	paper = arxiv_client.fetch_paper_by_id(arxiv_id)
	if paper is None:
		raise HTTPException(status_code=404, detail="Paper not found")

	try:
		summary = summarizer.summarize_paper(
			title=str(paper.get("title", "")),
			abstract=str(paper.get("abstract", "")),
		)
	except Exception as exc:
		raise HTTPException(status_code=500, detail="Failed to summarize paper") from exc

	return {"arxiv_id": str(paper.get("arxiv_id", arxiv_id)), "summary": summary}


@router.post("/api/papers/summarize-batch")
async def summarize_batch(payload: SummarizeBatchRequest) -> dict[str, list[dict[str, str]]]:
	arxiv_ids = [paper_id.strip() for paper_id in payload.arxiv_ids if paper_id.strip()]
	if not arxiv_ids:
		raise HTTPException(status_code=422, detail="arxiv_ids must contain at least one ID")

	fetched_papers: list[dict[str, Any]] = []
	for arxiv_id in arxiv_ids:
		paper = arxiv_client.fetch_paper_by_id(arxiv_id)
		if paper is not None:
			fetched_papers.append(paper)

	if not fetched_papers:
		return {"papers": []}

	summarized = summarizer.summarize_multiple(fetched_papers)
	papers_response = [
		{
			"arxiv_id": str(paper.get("arxiv_id", "")),
			"title": str(paper.get("title", "")),
			"summary": str(paper.get("summary", "Summary unavailable.")),
		}
		for paper in summarized
	]

	return {"papers": papers_response}
