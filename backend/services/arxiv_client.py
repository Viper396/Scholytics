from __future__ import annotations

import logging
import time
from datetime import date, datetime
from typing import Any

import arxiv

logger = logging.getLogger(__name__)

# arXiv's own access guidelines recommend <=3 requests per second for automated access.
_MAX_RETRIES = 3
_BACKOFF_BASE = 1.5  # seconds (exponential backoff base)


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


def _is_retryable_error(exc: Exception) -> bool:
	"""Return True only for transient network errors, not auth or client errors."""
	error_str = str(exc).lower()
	if any(term in error_str for term in ("401", "403", "unauthorized", "forbidden")):
		return False
	return True


def search_papers(
	query: str,
	max_results: int = 20,
	filters: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
	"""
	Search arXiv papers.

	Returns a (possibly empty) list on success.
	Raises RuntimeError on upstream failure so callers can distinguish
	"empty results" from "search pipeline failed".
	"""
	date_from = _parse_date_from(filters)
	categories = _parse_categories(filters)

	last_exc: Exception | None = None
	for attempt in range(_MAX_RETRIES):
		try:
			search = arxiv.Search(
				query=query,
				max_results=max_results,
				sort_by=arxiv.SortCriterion.Relevance,
			)
			client = arxiv.Client(num_retries=1, page_size=min(max_results, 25))

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

		except Exception as exc:  # noqa: BLE001
			last_exc = exc
			if not _is_retryable_error(exc):
				logger.error("Non-retryable arXiv search error: %s", exc)
				raise RuntimeError("arXiv search failed") from exc

			backoff = _BACKOFF_BASE ** attempt
			logger.warning(
				"arXiv search attempt %d/%d failed: %s — retrying in %.1fs",
				attempt + 1,
				_MAX_RETRIES,
				exc,
				backoff,
			)
			time.sleep(backoff)

	logger.error("arXiv search failed after %d attempts: %s", _MAX_RETRIES, last_exc)
	raise RuntimeError("arXiv search failed after retries") from last_exc


def fetch_paper_by_id(arxiv_id: str) -> dict[str, Any] | None:
	"""
	Fetch a single paper by arXiv ID.

	Returns None if the paper is not found.
	Raises RuntimeError on upstream failure.
	"""
	last_exc: Exception | None = None
	for attempt in range(_MAX_RETRIES):
		try:
			search = arxiv.Search(id_list=[arxiv_id], max_results=1)
			client = arxiv.Client(num_retries=1)

			result = next(client.results(search), None)
			if result is None:
				return None
			return _result_to_dict(result)

		except Exception as exc:  # noqa: BLE001
			last_exc = exc
			if not _is_retryable_error(exc):
				logger.error("Non-retryable arXiv fetch error for %s: %s", arxiv_id, exc)
				return None

			backoff = _BACKOFF_BASE ** attempt
			logger.warning(
				"arXiv fetch attempt %d/%d for %s failed: %s — retrying in %.1fs",
				attempt + 1,
				_MAX_RETRIES,
				arxiv_id,
				exc,
				backoff,
			)
			time.sleep(backoff)

	logger.error(
		"arXiv fetch for %s failed after %d attempts: %s",
		arxiv_id,
		_MAX_RETRIES,
		last_exc,
	)
	return None
