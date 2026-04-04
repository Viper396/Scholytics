from __future__ import annotations

from datetime import date, datetime
from typing import Any

import arxiv


def _parse_date_from(filters: dict[str, Any] | None) -> date | None:
	if not filters:
		return None
	raw_date = filters.get("date_from")
	if not raw_date:
		return None
	try:
		return datetime.strptime(str(raw_date), "%Y-%m-%d").date()
	except ValueError:
		return None


def _parse_categories(filters: dict[str, Any] | None) -> set[str]:
	if not filters:
		return set()
	raw_categories = filters.get("categories", [])
	if not isinstance(raw_categories, list):
		return set()
	return {str(category).strip() for category in raw_categories if str(category).strip()}


def _result_to_dict(result: arxiv.Result) -> dict[str, Any]:
	return {
		"arxiv_id": result.get_short_id(),
		"title": result.title,
		"authors": [author.name for author in result.authors],
		"abstract": result.summary,
		"published": result.published.date().isoformat(),
		"categories": list(result.categories),
		"pdf_url": result.pdf_url,
		"entry_url": result.entry_id,
	}


def search_papers(
	query: str,
	max_results: int = 20,
	filters: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
	date_from = _parse_date_from(filters)
	categories = _parse_categories(filters)

	try:
		search = arxiv.Search(
			query=query,
			max_results=max_results,
			sort_by=arxiv.SortCriterion.Relevance,
		)
		client = arxiv.Client()

		papers: list[dict[str, Any]] = []
		for result in client.results(search):
			if date_from and result.published.date() < date_from:
				continue
			if categories and not categories.intersection(result.categories):
				continue

			papers.append(_result_to_dict(result))

			if len(papers) >= max_results:
				break

		return papers
	except Exception:
		return []


def fetch_paper_by_id(arxiv_id: str) -> dict[str, Any] | None:
	try:
		search = arxiv.Search(id_list=[arxiv_id], max_results=1)
		client = arxiv.Client()

		result = next(client.results(search), None)
		if result is None:
			return None
		return _result_to_dict(result)
	except Exception:
		return None
