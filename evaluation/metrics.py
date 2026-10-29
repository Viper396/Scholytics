"""
Information Retrieval (IR) evaluation metrics for Scholytics.

Implements standard ranking metrics:
- Precision@K
- Recall@K
- Reciprocal Rank (RR) / Mean Reciprocal Rank (MRR)
- Normalized Discounted Cumulative Gain (nDCG@K)
"""
from __future__ import annotations

import math
from collections.abc import Sequence


def precision_at_k(
    retrieved_ids: Sequence[str],
    ground_truth: dict[str, int],
    k: int,
    relevance_threshold: int = 2,
) -> float:
    """
    Computes Precision@K: the fraction of retrieved documents in the top K
    that are relevant (relevance grade >= relevance_threshold).

    P@K = (# relevant retrieved in top K) / K
    """
    if k <= 0:
        return 0.0

    top_k = retrieved_ids[:k]
    if not top_k:
        return 0.0

    relevant_count = sum(
        1 for doc_id in top_k if ground_truth.get(doc_id, 0) >= relevance_threshold
    )
    return relevant_count / float(k)


def recall_at_k(
    retrieved_ids: Sequence[str],
    ground_truth: dict[str, int],
    k: int,
    relevance_threshold: int = 2,
) -> float:
    """
    Computes Recall@K: the fraction of all relevant documents that are
    successfully retrieved in the top K.

    R@K = (# relevant retrieved in top K) / (total relevant documents in candidate pool)
    """
    if k <= 0:
        return 0.0

    total_relevant = sum(
        1 for rel in ground_truth.values() if rel >= relevance_threshold
    )
    if total_relevant == 0:
        return 1.0 if not retrieved_ids else 0.0

    top_k = retrieved_ids[:k]
    relevant_retrieved = sum(
        1 for doc_id in top_k if ground_truth.get(doc_id, 0) >= relevance_threshold
    )
    return relevant_retrieved / float(total_relevant)


def reciprocal_rank(
    retrieved_ids: Sequence[str],
    ground_truth: dict[str, int],
    relevance_threshold: int = 2,
    k: int | None = None,
) -> float:
    """
    Computes Reciprocal Rank (RR): reciprocal of the 1-based rank position
    of the first relevant document retrieved.

    RR = 1 / rank_first_relevant (or 0.0 if no relevant document found in top K).
    """
    candidates = retrieved_ids[:k] if k is not None else retrieved_ids
    for rank, doc_id in enumerate(candidates, start=1):
        if ground_truth.get(doc_id, 0) >= relevance_threshold:
            return 1.0 / float(rank)
    return 0.0


def dcg_at_k(
    retrieved_ids: Sequence[str],
    ground_truth: dict[str, int],
    k: int,
) -> float:
    """
    Computes Discounted Cumulative Gain (DCG@K) using graded relevance:
    DCG@K = sum_{i=1}^K (2^{rel_i} - 1) / log2(i + 1)
    """
    if k <= 0:
        return 0.0

    top_k = retrieved_ids[:k]
    dcg = 0.0
    for rank, doc_id in enumerate(top_k, start=1):
        rel = ground_truth.get(doc_id, 0)
        if rel > 0:
            dcg += (math.pow(2.0, rel) - 1.0) / math.log2(rank + 1.0)
    return dcg


def ndcg_at_k(
    retrieved_ids: Sequence[str],
    ground_truth: dict[str, int],
    k: int,
) -> float:
    """
    Computes Normalized Discounted Cumulative Gain (nDCG@K):
    nDCG@K = DCG@K / IDCG@K (Ideal DCG@K)

    Guaranteed to return a float in [0.0, 1.0].
    """
    if k <= 0:
        return 0.0

    actual_dcg = dcg_at_k(retrieved_ids, ground_truth, k)
    if actual_dcg == 0.0:
        return 0.0

    # Ideal ranking: ground truth grades sorted descending
    ideal_grades = sorted(ground_truth.values(), reverse=True)[:k]
    idcg = 0.0
    for rank, rel in enumerate(ideal_grades, start=1):
        if rel > 0:
            idcg += (math.pow(2.0, rel) - 1.0) / math.log2(rank + 1.0)

    if idcg <= 0.0:
        return 0.0

    return min(1.0, max(0.0, actual_dcg / idcg))

