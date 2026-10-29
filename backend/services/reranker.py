from __future__ import annotations

import logging
import math
import os
from typing import Any

logger = logging.getLogger(__name__)

# CrossEncoder import check (graceful fallback if sentence-transformers is omitted)
try:
	from sentence_transformers import CrossEncoder
except Exception as _exc:  # noqa: BLE001
	CrossEncoder = None
	_IMPORT_ERROR = str(_exc)
else:
	_IMPORT_ERROR = None

_DEFAULT_RERANKER_MODEL = "cross-encoder/ms-marco-TinyBERT-L-2-v2"
_MODEL_NAME = os.getenv("RERANKER_MODEL_NAME", _DEFAULT_RERANKER_MODEL).strip() or _DEFAULT_RERANKER_MODEL
_ENABLE_RERANKER = os.getenv("ENABLE_RERANKER", "false").strip().lower() == "true"
_DEFAULT_MAX_CANDIDATES = 15
_MAX_TEXT_LEN = 1500

_MODEL: Any | None = None
_INIT_ERROR: str | None = None


def is_reranker_enabled() -> bool:
	"""Return whether reranking is enabled via environment configuration."""
	return _ENABLE_RERANKER


def _get_model():
	"""Singleton accessor for the cross-encoder model."""
	global _MODEL, _INIT_ERROR
	if not _ENABLE_RERANKER:
		return None
	if CrossEncoder is None:
		logger.debug("CrossEncoder unavailable: %s", _IMPORT_ERROR)
		return None
	if _MODEL is None:
		try:
			logger.info("Initializing CrossEncoder model: %s", _MODEL_NAME)
			_MODEL = CrossEncoder(_MODEL_NAME)
			_INIT_ERROR = None
			logger.info("CrossEncoder model initialized successfully.")
		except Exception as exc:  # noqa: BLE001
			_INIT_ERROR = str(exc)
			logger.error("Failed to initialize CrossEncoder model %s: %s", _MODEL_NAME, exc)
			return None
	return _MODEL


def warm_up() -> bool:
	"""Pre-initialize reranker model at startup if enabled."""
	if not _ENABLE_RERANKER:
		return False
	model = _get_model()
	return model is not None


def get_status() -> dict[str, Any]:
	"""Return diagnostic status information for the reranker."""
	return {
		"enabled": _ENABLE_RERANKER,
		"model": _MODEL_NAME,
		"available": CrossEncoder is not None,
		"loaded": _MODEL is not None,
		"error": _INIT_ERROR or _IMPORT_ERROR if not CrossEncoder else _INIT_ERROR,
	}


def _extract_text(candidate: dict[str, Any]) -> str:
	"""Extract concatenated title and abstract from candidate record."""
	metadata = candidate.get("metadata") or {}
	title = str(candidate.get("title") or metadata.get("title") or "").strip()
	abstract = str(candidate.get("abstract") or metadata.get("abstract") or "").strip()
	if title and abstract:
		return f"{title}. {abstract}"
	return title or abstract or ""


def _sanitize_score(score: Any) -> float:
	"""Convert prediction to a valid finite float."""
	try:
		val = float(score)
		if math.isnan(val) or math.isinf(val):
			return 0.0
		return val
	except (ValueError, TypeError):
		return 0.0


def rerank(
	query: str,
	candidates: list[dict[str, Any]],
	top_k: int | None = None,
	max_candidates: int = _DEFAULT_MAX_CANDIDATES,
) -> list[dict[str, Any]]:
	"""
	Rerank a bounded subset of retrieval candidates using a cross-encoder model.

	Safely falls back to original ranking if:
	- Reranker is disabled (ENABLE_RERANKER=false).
	- Model is unavailable or fails to initialize.
	- Prediction raises an error.
	- Candidates list is empty.

	Parameters
	----------
	query : str
		Search query.
	candidates : list[dict[str, Any]]
		Ranked results from initial retrieval (e.g. dense, BM25, or hybrid RRF).
	top_k : int | None
		Number of final results to return. Defaults to len(candidates).
	max_candidates : int
		Upper bound on number of candidates evaluated by the cross-encoder.

	Returns
	-------
	list[dict[str, Any]]
		Reranked (or fallback-ordered) candidate list with updated 'rerank_score'.
	"""
	if not candidates:
		return []

	target_k = top_k if top_k is not None and top_k > 0 else len(candidates)

	if not _ENABLE_RERANKER:
		return candidates[:target_k]

	clean_query = (query or "").strip()
	if not clean_query:
		return candidates[:target_k]

	model = _get_model()
	if model is None:
		logger.debug("Reranker model not available; returning original ordering.")
		return candidates[:target_k]

	# Enforce hard upper bound on candidate pool to prevent CPU stalls
	bound = max(1, min(len(candidates), max_candidates))
	eval_pool = candidates[:bound]
	remaining = candidates[bound:]

	pairs: list[tuple[str, str]] = []
	for candidate in eval_pool:
		doc_text = _extract_text(candidate)[:_MAX_TEXT_LEN]
		pairs.append((clean_query, doc_text))

	try:
		raw_scores = model.predict(pairs)
	except Exception as exc:  # noqa: BLE001
		logger.warning("Cross-encoder prediction failed: %s; falling back to original rank", exc)
		return candidates[:target_k]

	# Pair candidates with sanitized scores
	reranked: list[dict[str, Any]] = []
	for idx, candidate in enumerate(eval_pool):
		item = dict(candidate)
		score = _sanitize_score(raw_scores[idx]) if idx < len(raw_scores) else 0.0
		item["rerank_score"] = score
		reranked.append(item)

	# Sort by cross-encoder score descending
	reranked.sort(key=lambda x: x.get("rerank_score", 0.0), reverse=True)

	# Append any un-reranked candidates at the end, preserving their original order
	combined = reranked + remaining
	return combined[:target_k]
