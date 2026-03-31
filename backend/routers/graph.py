from __future__ import annotations

import asyncio
from itertools import combinations
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import arxiv_client

router = APIRouter(tags=["graph"])


class GraphRequest(BaseModel):
	arxiv_ids: list[str]
	relevance_scores: dict[str, float] | None = None


def _to_list_of_strings(value: Any) -> list[str]:
	if isinstance(value, list):
		return [str(item).strip() for item in value if str(item).strip()]
	if isinstance(value, str):
		return [part.strip() for part in value.split(",") if part.strip()]
	return []


@router.post("/api/graph")
async def build_graph(payload: GraphRequest) -> dict[str, list[dict[str, Any]]]:
	arxiv_ids: list[str] = []
	seen_ids: set[str] = set()
	for arxiv_id in payload.arxiv_ids:
		cleaned = arxiv_id.strip()
		if cleaned and cleaned not in seen_ids:
			arxiv_ids.append(cleaned)
			seen_ids.add(cleaned)

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
		if isinstance(fetched, dict) and fetched.get("arxiv_id"):
			papers.append(fetched)

	if not papers:
		raise HTTPException(status_code=404, detail="No papers found for the provided arXiv IDs")

	relevance_scores = payload.relevance_scores or {}

	nodes: list[dict[str, Any]] = []
	paper_index: dict[str, dict[str, Any]] = {}

	for paper in papers:
		paper_id = str(paper.get("arxiv_id", "")).strip()
		if not paper_id or paper_id in paper_index:
			continue

		authors = _to_list_of_strings(paper.get("authors"))
		categories = _to_list_of_strings(paper.get("categories"))
		relevance_value = paper.get("relevance_score", relevance_scores.get(paper_id, 0.0))
		try:
			relevance_score = float(relevance_value)
		except (TypeError, ValueError):
			relevance_score = 0.0

		node = {
			"id": paper_id,
			"title": str(paper.get("title", "")),
			"authors": authors,
			"published": str(paper.get("published", "")),
			"categories": categories,
			"relevance_score": relevance_score,
		}
		nodes.append(node)
		paper_index[paper_id] = {
			"authors": {author.lower() for author in authors},
			"categories": {category.lower() for category in categories},
		}

	edges: list[dict[str, Any]] = []
	node_ids = [node["id"] for node in nodes]

	for source_id, target_id in combinations(node_ids, 2):
		source_data = paper_index[source_id]
		target_data = paper_index[target_id]

		shared_authors = source_data["authors"].intersection(target_data["authors"])
		if shared_authors:
			edges.append(
				{
					"source": source_id,
					"target": target_id,
					"type": "co-author",
					"weight": len(shared_authors),
				}
			)
			continue

		shared_categories = source_data["categories"].intersection(target_data["categories"])
		if shared_categories:
			edges.append(
				{
					"source": source_id,
					"target": target_id,
					"type": "same-field",
					"weight": len(shared_categories),
				}
			)

	return {"nodes": nodes, "edges": edges}
