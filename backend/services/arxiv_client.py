from __future__ import annotations

import logging
import time
from datetime import date, datetime
from typing import Any

import arxiv

from services.cache import (
	arxiv_paper_cache,
	arxiv_search_cache,
	build_paper_cache_key,
	build_search_cache_key,
	sync_single_flight,
)

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

	Checks bounded LRU cache first; utilizes single-flight locking to prevent
	concurrent requests from hitting arXiv in parallel.
	Returns a (possibly empty) list on success.
	Raises RuntimeError on upstream failure so callers can distinguish
	"empty results" from "search pipeline failed".
	"""
	cache_key = build_search_cache_key(query=query, max_results=max_results, filters=filters)
	cached = arxiv_search_cache.get(cache_key)
	if cached is not None:
		logger.debug("arxiv_search_cache HIT for %r", query)
		return [dict(p) for p in cached]

	lock = sync_single_flight.get_lock(cache_key)
	try:
		with lock:
			# Double check after acquiring lock in case another thread populated it
			cached = arxiv_search_cache.get(cache_key)
			if cached is not None:
				return [dict(p) for p in cached]

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

					# Populate search cache and warm individual paper caches
					arxiv_search_cache.set(cache_key, papers)
					for p in papers:
						aid = p.get("arxiv_id")
						if aid:
							arxiv_paper_cache.set(build_paper_cache_key(str(aid)), p)

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
	finally:
		sync_single_flight.cleanup(cache_key)


def fetch_paper_by_id(arxiv_id: str) -> dict[str, Any] | None:
	"""
	Fetch a single paper by arXiv ID.

	Checks bounded LRU cache first; applies single-flight synchronization.
	Returns None if the paper is not found.
	Raises RuntimeError on upstream failure.
	"""
	paper_key = build_paper_cache_key(arxiv_id)
	cached = arxiv_paper_cache.get(paper_key)
	if cached is not None:
		logger.debug("arxiv_paper_cache HIT for %s", arxiv_id)
		return dict(cached)

	lock = sync_single_flight.get_lock(paper_key)
	try:
		with lock:
			cached = arxiv_paper_cache.get(paper_key)
			if cached is not None:
				return dict(cached)

			last_exc: Exception | None = None
			for attempt in range(_MAX_RETRIES):
				try:
					search = arxiv.Search(id_list=[arxiv_id], max_results=1)
					client = arxiv.Client(num_retries=1)

					result = next(client.results(search), None)
					if result is None:
						return None
					res_dict = _result_to_dict(result)
					arxiv_paper_cache.set(paper_key, res_dict)
					return res_dict

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
	finally:
		sync_single_flight.cleanup(paper_key)
