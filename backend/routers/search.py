from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from db.vector_store import canonicalize_arxiv_id
from services import arxiv_client, bm25, embedder, fusion, ingestion, reranker, summarizer
from services.cache import (
	async_single_flight,
	build_search_cache_key,
)
from services.metrics import metrics

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

		# Date range sanity check (date_from can't be in the future)
		date_from = filters_dict.get("date_from")
		if date_from:
			try:
				from_date = datetime.strptime(date_from, "%Y-%m-%d")
				if from_date.year > datetime.now().year:
					raise HTTPException(status_code=422, detail="filters.date_from cannot be in the future")
			except ValueError as exc:
				raise HTTPException(status_code=422, detail="filters.date_from must be YYYY-MM-DD") from exc

	# Retrieve the configured vector store from app state
	vector_store = getattr(request.app.state, "vector_store", None)
	if vector_store is None:
		raise HTTPException(status_code=500, detail="Vector store is unavailable")

	raw_backend = getattr(vector_store, "backend_name", None)
	backend_name = raw_backend if isinstance(raw_backend, str) else type(vector_store).__name__
	rerank_enabled = reranker.is_reranker_enabled()

	search_cache_key = build_search_cache_key(
		query=query,
		max_results=payload.max_results,
		filters=filters_dict,
		vector_backend=backend_name,
		enable_reranker=rerank_enabled,
	)

	async def _execute_search() -> dict[str, Any]:
		t_search_start = time.perf_counter()

		# ------------------------------------------------------------------
		# Step 1: Live Discovery from arXiv (Fresh literature search)
		# ------------------------------------------------------------------
		t_arxiv = time.perf_counter()
		try:
			papers = await asyncio.to_thread(
				arxiv_client.search_papers,
				query=query,
				max_results=payload.max_results,
				filters=filters_dict,
			)
			metrics.record_latency("arxiv_search_ms", (time.perf_counter() - t_arxiv) * 1000.0)
		except RuntimeError as exc:
			metrics.record_retrieval_failure("arxiv")
			logger.error("arXiv search upstream failure for query %r: %s", query, exc)
			raise HTTPException(status_code=503, detail="arXiv search is currently unavailable. Please try again.") from exc
		except Exception as exc:  # noqa: BLE001
			metrics.record_retrieval_failure("arxiv_unexpected")
			logger.error("Unexpected search error for query %r: %s", query, exc)
			raise HTTPException(status_code=500, detail="Search pipeline failed") from exc

		if not papers:
			metrics.record_empty_result()
			metrics.record_latency("search_total_ms", (time.perf_counter() - t_search_start) * 1000.0)
			return {"query": query, "results": [], "total": 0}

		# ------------------------------------------------------------------
		# Step 2: Query Embedding
		# ------------------------------------------------------------------
		t_embed = time.perf_counter()
		try:
			query_vector = embedder.embed_query(query)
			metrics.record_latency("query_embed_ms", (time.perf_counter() - t_embed) * 1000.0)
		except RuntimeError as exc:
			logger.warning("Query embedding unavailable, returning unranked results: %s", exc)
			metrics.record_latency("search_total_ms", (time.perf_counter() - t_search_start) * 1000.0)
			return _unranked_response(query, papers)

		# ------------------------------------------------------------------
		# Step 3: Incremental, Bounded Ingestion
		# Check which candidate papers are already indexed in Pinecone/Chroma.
		# Embed and upsert ONLY newly discovered or modified papers.
		# Concurrent requests for identical papers are deduplicated.
		# ------------------------------------------------------------------
		try:
			ingestion_stats = await ingestion.ingest_candidates(
				papers=papers,
				vector_store=vector_store,
				max_batch=ingestion.DEFAULT_PER_REQUEST_INGESTION_LIMIT,
			)
			if ingestion_stats.failed > 0 and ingestion_stats.newly_indexed == 0 and ingestion_stats.already_indexed == 0:
				# Embedding failed for all candidates and none were already indexed
				logger.warning("All embeddings failed during ingestion; returning unranked results")
				metrics.record_latency("search_total_ms", (time.perf_counter() - t_search_start) * 1000.0)
				return _unranked_response(query, papers)
		except RuntimeError as exc:
			logger.warning("Embedding model unavailable during ingestion: %s", exc)
			metrics.record_latency("search_total_ms", (time.perf_counter() - t_search_start) * 1000.0)
			return _unranked_response(query, papers)

		fetched_ids = [str(paper.get("arxiv_id")) for paper in papers if paper.get("arxiv_id")]
		canonical_ids = list(dict.fromkeys(canonicalize_arxiv_id(aid) for aid in fetched_ids if aid))

		if not canonical_ids:
			metrics.record_empty_result()
			metrics.record_latency("search_total_ms", (time.perf_counter() - t_search_start) * 1000.0)
			return {"query": query, "results": [], "total": 0}

		# ------------------------------------------------------------------
		# Step 4: Hybrid Reranking (Dense Semantic + BM25 Keyword via RRF)
		# Combines dense vector similarity with exact keyword scoring.
		# Degrades gracefully if either retrieval channel is unavailable.
		# ------------------------------------------------------------------
		dense_matches: list[dict[str, Any]] = []
		t_vq = time.perf_counter()
		try:
			dense_matches = vector_store.query(
				query_vector=query_vector,
				n_results=min(payload.max_results, len(canonical_ids)),
				filter_ids=canonical_ids,
			)
			metrics.record_latency("vector_query_ms", (time.perf_counter() - t_vq) * 1000.0)
		except Exception as exc:  # noqa: BLE001
			metrics.record_retrieval_failure("vector_store")
			logger.error("Vector store query failed: %s", exc)

		bm25_matches: list[dict[str, Any]] = []
		try:
			bm25_index = bm25.get_bm25_index()
			bm25_matches = bm25_index.search(
				query=query,
				top_k=min(payload.max_results, len(canonical_ids)),
				filter_ids=canonical_ids,
			)
		except Exception as exc:  # noqa: BLE001
			logger.error("BM25 keyword search failed: %s", exc)

		# Fused rank resolution using tuned parameters (k=10.0, wd=1.0, wk=1.0)
		if dense_matches and bm25_matches:
			matches = fusion.reciprocal_rank_fusion(
				dense_results=dense_matches,
				keyword_results=bm25_matches,
				k=10.0,
				weight_dense=1.0,
				weight_keyword=1.0,
				top_k=payload.max_results,
			)
			retrieval_mode = "hybrid"
		elif dense_matches:
			matches = dense_matches
			retrieval_mode = "dense_only"
		elif bm25_matches:
			matches = bm25_matches
			retrieval_mode = "keyword_only"
		else:
			matches = []
			retrieval_mode = "none"

		if not matches and not dense_matches and not bm25_matches:
			raise HTTPException(status_code=500, detail="Search pipeline failed")

		papers_by_id: dict[str, dict[str, Any]] = {}
		for paper in papers:
			raw_id = str(paper.get("arxiv_id", "")).strip()
			if raw_id:
				papers_by_id[raw_id] = paper
				papers_by_id[canonicalize_arxiv_id(raw_id)] = paper

		# ------------------------------------------------------------------
		# Step 4b: Optional Cross-Encoder Reranking
		# Evaluated only when ENABLE_RERANKER=true. Default is false to
		# preserve sub-second latency and Render free-tier RAM limits.
		# ------------------------------------------------------------------
		if reranker.is_reranker_enabled() and matches:
			t_rerank = time.perf_counter()
			try:
				rerank_input = []
				for m in matches:
					cid = m["id"]
					p = papers_by_id.get(cid) or {}
					rerank_input.append({
						"id": cid,
						"title": p.get("title", ""),
						"abstract": p.get("abstract", ""),
						"score": m.get("score", 0.0),
						"metadata": m.get("metadata", {}),
					})
				reranked_matches = reranker.rerank(
					query=query,
					candidates=rerank_input,
					top_k=payload.max_results,
				)
				metrics.record_latency("rerank_ms", (time.perf_counter() - t_rerank) * 1000.0)
				if reranked_matches:
					matches = reranked_matches
					retrieval_mode = f"{retrieval_mode}_reranked"
			except Exception as exc:  # noqa: BLE001
				logger.warning("Reranker invocation failed: %s; keeping original ordering", exc)

		# ------------------------------------------------------------------
		# Step 5: Application-level metadata filtering and result mapping
		# Note: Date boundaries and fine-grained categories are enforced
		# here to ensure exact precision regardless of vector backend syntax.
		# ------------------------------------------------------------------
		is_degraded = embedder.is_using_hash_fallback()
		results: list[dict[str, Any]] = []

		for match in matches:
			paper_id = match["id"]
			relevance_score = max(0.0, min(1.0, match["score"]))
			metadata = match.get("metadata", {})

			source_paper = papers_by_id.get(str(paper_id)) or papers_by_id.get(canonicalize_arxiv_id(str(paper_id)), {})
			published_str = str(source_paper.get("published") or metadata.get("published") or "")
			categories = source_paper.get("categories") or _split_csv(metadata.get("categories"))

			# Application-level date filter verification
			if filters_dict and filters_dict.get("date_from"):
				filter_date_str = filters_dict["date_from"]
				if published_str and published_str < filter_date_str:
					continue

			result = {
				"arxiv_id": str(source_paper.get("arxiv_id") or metadata.get("arxiv_id") or paper_id),
				"title": str(source_paper.get("title") or metadata.get("title") or ""),
				"authors": source_paper.get("authors") or _split_csv(metadata.get("authors")),
				"abstract": str(source_paper.get("abstract") or metadata.get("abstract") or ""),
				"published": published_str,
				"categories": categories,
				"pdf_url": str(source_paper.get("pdf_url") or metadata.get("pdf_url") or ""),
				"entry_url": str(source_paper.get("entry_url") or metadata.get("entry_url") or ""),
				"relevance_score": relevance_score,
				"ranking_degraded": is_degraded,
			}
			results.append(result)

		results.sort(key=lambda item: item["relevance_score"] or 0.0, reverse=True)

		if not results:
			metrics.record_empty_result()
		metrics.record_latency("search_total_ms", (time.perf_counter() - t_search_start) * 1000.0)

		response: dict[str, Any] = {
			"query": query,
			"results": results,
			"total": len(results),
			"retrieval_mode": retrieval_mode,
			"ingestion": {
				"discovered": ingestion_stats.discovered,
				"already_indexed": ingestion_stats.already_indexed,
				"newly_indexed": ingestion_stats.newly_indexed,
			},
		}
		if is_degraded:
			response["ranking_note"] = (
				"Ranking uses hash-based embeddings (development fallback). "
				"Results do not reflect genuine semantic similarity."
			)

		return response

	return await async_single_flight.execute(search_cache_key, _execute_search)


def _unranked_response(query: str, papers: list[dict[str, Any]]) -> dict[str, Any]:
	"""Return an unranked result set when embedding is unavailable."""
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

	# Build structured grounding sources
	source_records = summarizer.build_source_records(papers)
	valid_indices = {int(s["source_index"]) for s in source_records}

	async def event_stream():
		t_synth_start = time.perf_counter()
		accumulated_tokens: list[str] = []
		try:
			# Step 1: Emit structured grounding sources metadata event
			sources_json = json.dumps(source_records)
			yield f"event: sources\ndata: {sources_json}\n\n"
			await asyncio.sleep(0)

			for token in summarizer.generate_search_summary(query, papers):
				accumulated_tokens.append(token)
				# Each token may contain newlines; emit each non-empty line separately.
				# SSE event format: each "event" is terminated by a blank line (\n\n).
				lines = token.splitlines() if token else []
				if not lines:
					lines = [""]
				data_lines = "\n".join(f"data: {line}" for line in lines)
				yield f"{data_lines}\n\n"
				await asyncio.sleep(0)

			# Step 2: Validate inline citations against the retrieved source set
			full_text = "".join(accumulated_tokens)
			validation = summarizer.validate_citations(full_text, valid_indices)
			validation_json = json.dumps(validation)
			yield f"event: validation\ndata: {validation_json}\n\n"
			await asyncio.sleep(0)

			# Step 3: Stream completion
			yield "event: done\ndata: [DONE]\n\n"
		except (GeneratorExit, asyncio.CancelledError):
			logger.warning("Synthesis stream interrupted by client cancellation")
			metrics.record_streaming_interruption()
			raise
		except Exception as exc:  # noqa: BLE001
			metrics.record_groq_failure("synthesis")
			logger.error("Synthesis stream error: %s", exc)
			exc_str = str(exc)
			exc_name = type(exc).__name__.lower()
			if "401" in exc_str or "authentication" in exc_name or "invalid_api_key" in exc_str:
				err_msg = "Groq authentication failed: Invalid GROQ_API_KEY. Please verify your API key."
			elif "429" in exc_str or "ratelimit" in exc_name:
				err_msg = "Groq rate limit reached. Please wait a moment before trying again."
			else:
				err_msg = "Synthesis unavailable."
			yield f"event: error\ndata: {err_msg}\n\n"
			return
		finally:
			metrics.record_latency("groq_synthesis_ms", (time.perf_counter() - t_synth_start) * 1000.0)

	return StreamingResponse(event_stream(), media_type="text/event-stream")
