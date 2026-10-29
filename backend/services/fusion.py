"""
Ranking Fusion Module for Hybrid Search.

Combines heterogeneous rankings (dense semantic similarity and BM25 exact keyword matches)
using Reciprocal Rank Fusion (RRF).

Mathematical Formulation:
--------------------------
For each candidate document d:
    RRF(d) = sum_{m in M} ( w_m / (k + r_m(d)) )

where:
  - M = {dense, keyword}
  - r_m(d) is the 1-based rank of document d in ranker m (1, 2, ...)
  - If document d does not appear in ranker m, its contribution is 0
  - k is the rank-smoothing constant (default: 60.0, or tuned on the evaluation benchmark)
  - w_m is the ranker weight (weight_dense, weight_keyword)

Scale & Invariant Properties:
------------------------------
- Scale-invariant: Does not depend on arbitrary min-max score normalizations.
- Outlier-resistant: Highly robust to score distribution shifts between dense and sparse models.
- Graceful partial-failure degradation: If either dense or keyword search fails or returns empty,
  the fusion safely degenerates to the surviving ranker without crashing or returning empty results.
"""

from __future__ import annotations

import logging
from typing import Any

from db.vector_store import canonicalize_arxiv_id

logger = logging.getLogger(__name__)

DEFAULT_RRF_K = 60.0
DEFAULT_DENSE_WEIGHT = 1.0
DEFAULT_KEYWORD_WEIGHT = 1.0


def reciprocal_rank_fusion(
    dense_results: list[dict[str, Any]],
    keyword_results: list[dict[str, Any]],
    k: float = DEFAULT_RRF_K,
    weight_dense: float = DEFAULT_DENSE_WEIGHT,
    weight_keyword: float = DEFAULT_KEYWORD_WEIGHT,
    top_k: int | None = None,
) -> list[dict[str, Any]]:
    """
    Fuse dense semantic search results and keyword search results using
    Reciprocal Rank Fusion (RRF).

    Args:
        dense_results: List of dicts with keys 'id', 'score', and optional 'metadata'.
        keyword_results: List of dicts with keys 'id', 'score', and optional 'metadata'.
        k: Smoothing constant. Default 60.0.
        weight_dense: Weight multiplier for dense ranks.
        weight_keyword: Weight multiplier for keyword ranks.
        top_k: Maximum number of merged results to return. If None, returns all.

    Returns:
        List of merged result dicts sorted descending by combined relevance score.
        Deduplicated by canonical arXiv ID.
    """
    if not dense_results and not keyword_results:
        return []

    # Map canonical ID -> ranks, scores, and metadata
    dense_ranks: dict[str, int] = {}
    dense_scores: dict[str, float] = {}
    all_metadata: dict[str, dict[str, Any]] = {}

    for idx, item in enumerate(dense_results, start=1):
        raw_id = str(item.get("id") or item.get("arxiv_id", "")).strip()
        if not raw_id:
            continue
        cid = canonicalize_arxiv_id(raw_id)
        if cid not in dense_ranks:
            dense_ranks[cid] = idx
            dense_scores[cid] = float(item.get("score") or 0.0)
            all_metadata[cid] = dict(item.get("metadata") or item)

    keyword_ranks: dict[str, int] = {}
    keyword_scores: dict[str, float] = {}

    for idx, item in enumerate(keyword_results, start=1):
        raw_id = str(item.get("id") or item.get("arxiv_id", "")).strip()
        if not raw_id:
            continue
        cid = canonicalize_arxiv_id(raw_id)
        if cid not in keyword_ranks:
            keyword_ranks[cid] = idx
            keyword_scores[cid] = float(item.get("score") or 0.0)
            # If metadata not already present or is richer, merge it
            if cid not in all_metadata or (not all_metadata[cid] and item.get("metadata")):
                all_metadata[cid] = dict(item.get("metadata") or item)

    all_ids = set(dense_ranks.keys()).union(set(keyword_ranks.keys()))
    if not all_ids:
        return []

    # Maximum achievable RRF score for score normalization to [0, 1]
    active_dense_weight = weight_dense if dense_ranks else 0.0
    active_keyword_weight = weight_keyword if keyword_ranks else 0.0
    denom_max = (active_dense_weight / (k + 1.0)) + (active_keyword_weight / (k + 1.0))
    if denom_max <= 0.0:
        denom_max = 1.0

    fused_results: list[dict[str, Any]] = []

    for cid in all_ids:
        rrf_score = 0.0
        r_dense = dense_ranks.get(cid)
        r_keyword = keyword_ranks.get(cid)

        if r_dense is not None:
            rrf_score += weight_dense / (k + float(r_dense))
        if r_keyword is not None:
            rrf_score += weight_keyword / (k + float(r_keyword))

        # Normalize score into [0.0, 1.0]
        normalized_score = min(1.0, max(0.0, rrf_score / denom_max))

        fused_results.append(
            {
                "id": cid,
                "score": normalized_score,
                "raw_rrf_score": rrf_score,
                "dense_rank": r_dense,
                "keyword_rank": r_keyword,
                "dense_score": dense_scores.get(cid),
                "keyword_score": keyword_scores.get(cid),
                "metadata": all_metadata.get(cid, {}),
            }
        )

    # Sort descending by normalized RRF score
    fused_results.sort(key=lambda x: x["score"], reverse=True)

    if top_k is not None and top_k > 0:
        return fused_results[:top_k]

    return fused_results
