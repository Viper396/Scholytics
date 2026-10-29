from __future__ import annotations

import asyncio
import logging
import re
from itertools import combinations
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from services import arxiv_client

logger = logging.getLogger(__name__)

router = APIRouter(tags=["graph"])

_ARXIV_ID_PATTERN = re.compile(r"^\d{4}\.\d{4,5}(v\d+)?$")
_MAX_GRAPH_NODES = 25


class GraphRequest(BaseModel):
	arxiv_ids: list[str] = Field(..., min_length=1, max_length=_MAX_GRAPH_NODES)
	relevance_scores: dict[str, float] | None = None

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


def _to_list_of_strings(value: Any) -> list[str]:
	if isinstance(value, list):
		return [str(item).strip() for item in value if str(item).strip()]
	if isinstance(value, str):
		return [part.strip() for part in value.split(",") if part.strip()]
	return []


@router.post("/api/graph")
async def build_graph(payload: GraphRequest) -> dict[str, list[dict[str, Any]]]:
	arxiv_ids = payload.arxiv_ids  # already validated and deduplicated

	# Fetch papers concurrently with bounded concurrency.
	sem = asyncio.Semaphore(5)

	async def bounded_fetch(aid: str) -> dict[str, Any] | None:
		async with sem:
			return await asyncio.to_thread(arxiv_client.fetch_paper_by_id, aid)

	fetch_tasks = [bounded_fetch(arxiv_id) for arxiv_id in arxiv_ids]
	fetched_results = await asyncio.gather(*fetch_tasks, return_exceptions=True)

	papers: list[dict[str, Any]] = []
	for fetched in fetched_results:
		if isinstance(fetched, BaseException):
			logger.warning("Graph fetch exception: %s", fetched)
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

		# Check co-authorship (shared authors between papers).
		shared_authors = source_data["authors"].intersection(target_data["authors"])
		if shared_authors:
			edges.append(
				{
					"source": source_id,
					"target": target_id,
					# "co-author" means the two papers share at least one author.
					# This is NOT a citation relationship.
					"type": "co-author",
					"weight": len(shared_authors),
				}
			)
			continue

		# Check shared research field (shared arXiv primary categories).
		shared_categories = source_data["categories"].intersection(target_data["categories"])
		if shared_categories:
			edges.append(
				{
					"source": source_id,
					"target": target_id,
					# "same-field" means these papers share at least one arXiv category.
					# This is NOT a citation relationship.
					"type": "same-field",
					"weight": len(shared_categories),
				}
			)

	return {"nodes": nodes, "edges": edges}
