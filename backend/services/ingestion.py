"""
Paper ingestion coordinator and version-aware indexing service.

Separates paper discovery from embedding and storage:
1. Checks persistent vector store for existing records by canonical arXiv ID.
2. Evaluates version suffixes (e.g. v1 vs v2) and content fingerprints (SHA-256).
3. Embeds and upserts ONLY new or meaningfully modified papers.
4. Uses a lightweight in-memory concurrency coordinator to prevent simultaneous
   requests from embedding identical papers redundantly.
5. Limits indexing batches to bounded sizes to respect Render memory and execution time limits.

Concurrency & Multi-Instance Limitations:
------------------------------------------
The in-memory lock coordinates concurrency within a single Python process (such as
the Render free-tier single-worker instance). In horizontal multi-worker or multi-container
deployments, a distributed locking store (e.g. Redis Redlock) would be required to coordinate
across processes. To honor the zero-cost free-tier deployment constraint, this coordinator
avoids adding paid or heavy infrastructure while completely protecting the single-instance backend.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any

from db.vector_store import (
    VectorStore,
    canonicalize_arxiv_id,
    compute_paper_hash,
    extract_arxiv_version,
)
from services import embedder

logger = logging.getLogger(__name__)

# Default maximum number of papers to embed and index during a single user query
DEFAULT_PER_REQUEST_INGESTION_LIMIT = 10


@dataclass
class IngestionStats:
    """Telemetry describing work performed during an ingestion pass."""

    discovered: int = 0
    already_indexed: int = 0
    newly_indexed: int = 0
    in_flight_skipped: int = 0
    failed: int = 0

    @property
    def total_processed(self) -> int:
        return self.already_indexed + self.newly_indexed + self.in_flight_skipped


class IngestionCoordinator:
    """
    Lightweight, asyncio-safe concurrency coordinator for paper ingestion.

    Prevents concurrent search or ingestion requests from redundantly embedding
    and upserting the exact same papers in parallel.
    """

    def __init__(self) -> None:
        self._in_flight: set[str] = set()
        self._lock = asyncio.Lock()

    async def filter_and_claim(self, canonical_ids: list[str]) -> tuple[list[str], list[str]]:
        """
        Atomically inspect *canonical_ids* and claim ownership of those not
        already in-flight.

        Returns:
            (claimed_ids, already_in_flight_ids)
        """
        async with self._lock:
            claimed: list[str] = []
            in_flight: list[str] = []
            for cid in canonical_ids:
                if cid in self._in_flight:
                    in_flight.append(cid)
                else:
                    self._in_flight.add(cid)
                    claimed.append(cid)
            return claimed, in_flight

    async def release(self, claimed_ids: list[str]) -> None:
        """Release ownership of *claimed_ids* after indexing finishes."""
        if not claimed_ids:
            return
        async with self._lock:
            for cid in claimed_ids:
                self._in_flight.discard(cid)


# Global singleton coordinator for the backend process
_coordinator = IngestionCoordinator()


def get_ingestion_coordinator() -> IngestionCoordinator:
    """Return the application-wide ingestion coordinator."""
    return _coordinator


def should_reindex_paper(candidate: dict[str, Any], existing_record: dict[str, Any] | None) -> bool:
    """
    Determine whether a paper is new or meaningfully changed.

    Returns True if:
    1. The paper is not present in the vector store.
    2. The paper version in arXiv is newer or different from the stored version.
    3. The content fingerprint (SHA-256 of title + abstract) differs from stored hash.
    """
    if not existing_record:
        return True

    stored_metadata = existing_record.get("metadata", {})
    if not stored_metadata:
        return True

    raw_id = str(candidate.get("arxiv_id", ""))
    candidate_version = extract_arxiv_version(raw_id)
    stored_version = stored_metadata.get("version", "")

    # If version changed (e.g. stored was v1, candidate is v2), re-index
    if candidate_version and stored_version and candidate_version != stored_version:
        logger.info(
            "Paper %s version changed (%s -> %s); triggering re-index",
            canonicalize_arxiv_id(raw_id),
            stored_version,
            candidate_version,
        )
        return True

    # Check content fingerprint
    title = str(candidate.get("title", ""))
    abstract = str(candidate.get("abstract", ""))
    candidate_hash = compute_paper_hash(title, abstract)
    stored_hash = stored_metadata.get("content_hash", "")

    if stored_hash and candidate_hash != stored_hash:
        logger.info(
            "Paper %s content fingerprint changed; triggering re-index",
            canonicalize_arxiv_id(raw_id),
        )
        return True

    # If already stored with valid metadata and matching version/hash, do not re-index
    return False


async def ingest_candidates(
    papers: list[dict[str, Any]],
    vector_store: VectorStore,
    max_batch: int = DEFAULT_PER_REQUEST_INGESTION_LIMIT,
    coordinator: IngestionCoordinator | None = None,
) -> IngestionStats:
    """
    Ingest a candidate set of papers into the persistent vector store with
    deduplication, version checking, and concurrency control.

    Args:
        papers: List of candidate paper dictionaries from arXiv or scraper.
        vector_store: Target vector store adapter.
        max_batch: Maximum number of new papers to embed and upsert in this call.
        coordinator: Concurrency coordinator (defaults to process singleton).

    Returns:
        IngestionStats summarizing what was skipped, claimed, newly indexed, or failed.
    """
    stats = IngestionStats(discovered=len(papers))
    if not papers:
        return stats

    coord = coordinator or _coordinator

    # 1. Normalize and canonicalize paper identifiers
    canonical_map: dict[str, dict[str, Any]] = {}
    for p in papers:
        raw_id = str(p.get("arxiv_id", "")).strip()
        if not raw_id:
            continue
        cid = canonicalize_arxiv_id(raw_id)
        if cid not in canonical_map:
            canonical_map[cid] = p

    canonical_ids = list(canonical_map.keys())
    if not canonical_ids:
        return stats

    # 2. Query vector store for existing records by canonical ID
    existing_records = vector_store.fetch_records(canonical_ids)

    # Populate BM25 keyword index with all discovered candidate papers
    from services.bm25 import get_bm25_index  # noqa: PLC0415
    bm25_index = get_bm25_index()
    for cid, paper in canonical_map.items():
        text = f"{paper.get('title', '')}. {paper.get('abstract', '')}".strip()
        bm25_index.add_document(doc_id=cid, text=text, metadata=paper)

    # 3. Partition into papers needing indexing vs. already indexed
    to_index_candidates: list[dict[str, Any]] = []
    for cid, paper in canonical_map.items():
        existing = existing_records.get(cid)
        if should_reindex_paper(paper, existing):
            to_index_candidates.append(paper)
        else:
            stats.already_indexed += 1

    if not to_index_candidates:
        logger.debug(
            "All %d discovered papers are already indexed and up-to-date",
            stats.already_indexed,
        )
        return stats

    # 4. Check concurrency coordinator to avoid duplicate concurrent in-flight work
    needed_ids = [canonicalize_arxiv_id(str(p.get("arxiv_id", ""))) for p in to_index_candidates]
    claimed_ids, in_flight_ids = await coord.filter_and_claim(needed_ids)
    stats.in_flight_skipped = len(in_flight_ids)

    if not claimed_ids:
        logger.debug("All needed papers are currently in-flight by other requests")
        return stats

    # Filter candidates to only those whose ID was claimed
    claimed_set = set(claimed_ids)
    papers_to_embed = [
        p for p in to_index_candidates
        if canonicalize_arxiv_id(str(p.get("arxiv_id", ""))) in claimed_set
    ]

    # Bound batch size to respect Render memory and time limits
    if len(papers_to_embed) > max_batch:
        logger.info(
            "Bounding ingestion from %d to %d papers to respect resource limits",
            len(papers_to_embed),
            max_batch,
        )
        # Separate the portion we won't embed now so their claim is released
        embedding_batch = papers_to_embed[:max_batch]
        unembedded_batch = papers_to_embed[max_batch:]
        unembedded_ids = [canonicalize_arxiv_id(str(p.get("arxiv_id", ""))) for p in unembedded_batch]
        await coord.release(unembedded_ids)
        papers_to_embed = embedding_batch

    active_claimed_ids = [canonicalize_arxiv_id(str(p.get("arxiv_id", ""))) for p in papers_to_embed]

    # 5. Embed and upsert the bounded batch
    try:
        upserted_count = embedder.index_papers(papers_to_embed, vector_store)
        stats.newly_indexed = upserted_count
        logger.info(
            "Ingestion completed: %d newly indexed, %d already present, %d in-flight skipped",
            stats.newly_indexed,
            stats.already_indexed,
            stats.in_flight_skipped,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to embed and index papers: %s", exc)
        stats.failed = len(papers_to_embed)
    finally:
        # Always release in-flight claims so future requests are never blocked
        await coord.release(active_claimed_ids)

    return stats
