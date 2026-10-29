"""
Pinecone adapter implementing the VectorStore interface.

Uses the official Pinecone Python SDK v5+ (class-based client, not the legacy
``pinecone.init()`` pattern). This adapter is selected at startup when the
``VECTOR_STORE_BACKEND`` environment variable is set to ``"pinecone"``.

Required environment variables
-------------------------------
PINECONE_API_KEY      – Pinecone API key (mandatory when backend=pinecone).
PINECONE_INDEX_NAME   – Target index name (default: ``scholytics-papers``).

Optional environment variables
-------------------------------
PINECONE_HOST         – Direct index data-plane host URL (e.g.
                        https://scholytics-papers-xxxx.svc.aped-4627-b74a.pinecone.io).
                        When provided, bypasses control-plane list calls.
PINECONE_CLOUD        – Cloud provider for serverless index (default: ``aws``).
PINECONE_REGION       – Region for serverless index (default: ``us-east-1``).
PINECONE_AUTO_CREATE_INDEX – If ``true``, creates the index automatically if not found.

Vector ID and Deduplication Policy
-----------------------------------
Vector IDs are deterministic canonical arXiv IDs stripped of any version suffixes
(e.g., ``2301.00001v2`` -> ``2301.00001``). Upserting a revised version or metadata update
for a paper safely overwrites the existing vector in-place, eliminating duplicates.

Metadata schema per vector
--------------------------
arxiv_id     : str  (canonical ID)
version      : str  (e.g. "v1", "v2")
content_hash : str  (16-char sha256 fingerprint of title + abstract)
title        : str
abstract     : str  (up to 2000 characters)
authors      : str  (comma-separated)
published    : str
categories   : str  (comma-separated)
pdf_url      : str
entry_url    : str
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

from db.vector_store import (
    VectorStore,
    canonicalize_arxiv_id,
    compute_paper_hash,
    extract_arxiv_version,
)
from services.metrics import metrics

logger = logging.getLogger(__name__)

_DEFAULT_INDEX_NAME = "scholytics-papers"
_UPSERT_BATCH_SIZE = 100  # Pinecone recommended batch ceiling
_FETCH_BATCH_SIZE = 100   # Pinecone recommended fetch ceiling
_MAX_ABSTRACT_METADATA_LEN = 2000


class PineconeAdapter(VectorStore):
    """Vector store backed by a Pinecone serverless index."""

    def __init__(self) -> None:
        api_key = os.getenv("PINECONE_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError(
                "PINECONE_API_KEY is not set. "
                "Add it as a Render environment variable before using the Pinecone backend."
            )

        index_name = os.getenv("PINECONE_INDEX_NAME", _DEFAULT_INDEX_NAME).strip() or _DEFAULT_INDEX_NAME

        # Import lazily so that chromadb-only environments don't need pinecone installed.
        from pinecone import Pinecone  # noqa: PLC0415

        self._pc = Pinecone(api_key=api_key)
        self._index_name = index_name
        self._index = self._connect_index()
        logger.info("PineconeAdapter: connected to index %r", index_name)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _connect_index(self):
        """Return a connected Index object, verifying availability."""
        host = os.getenv("PINECONE_HOST", "").strip() or None
        if host:
            logger.info("PineconeAdapter: connecting directly to host %s", host)
            return self._pc.Index(self._index_name, host=host)

        existing = [idx.name for idx in self._pc.list_indexes()]
        if self._index_name not in existing:
            auto_create = os.getenv("PINECONE_AUTO_CREATE_INDEX", "false").strip().lower() == "true"
            if auto_create:
                from pinecone import ServerlessSpec  # noqa: PLC0415

                cloud = os.getenv("PINECONE_CLOUD", "aws").strip() or "aws"
                region = os.getenv("PINECONE_REGION", "us-east-1").strip() or "us-east-1"
                logger.info(
                    "PineconeAdapter: index %r not found; auto-creating (cloud=%s, region=%s)...",
                    self._index_name,
                    cloud,
                    region,
                )
                self._pc.create_index(
                    name=self._index_name,
                    dimension=384,
                    metric="cosine",
                    spec=ServerlessSpec(cloud=cloud, region=region),
                )
            else:
                raise RuntimeError(
                    f"Pinecone index {self._index_name!r} does not exist. "
                    "Create it in the Pinecone console (dimension=384, metric=cosine, serverless) "
                    "or set PINECONE_AUTO_CREATE_INDEX=true before starting the backend."
                )

        return self._pc.Index(self._index_name)

    @staticmethod
    def _to_csv(value: Any) -> str:
        if isinstance(value, list):
            return ", ".join(str(item) for item in value)
        if value is None:
            return ""
        return str(value)

    # ------------------------------------------------------------------
    # VectorStore interface
    # ------------------------------------------------------------------

    def upsert_papers(
        self,
        papers: list[dict[str, Any]],
        embeddings: list[list[float]],
    ) -> int:
        if not papers or not embeddings:
            return 0

        vectors: list[dict[str, Any]] = []
        for paper, embedding in zip(papers, embeddings):
            raw_id = paper.get("arxiv_id")
            if not raw_id:
                continue
            canonical_id = canonicalize_arxiv_id(str(raw_id))
            title = str(paper.get("title", ""))
            abstract = str(paper.get("abstract", ""))
            truncated_abstract = abstract[:_MAX_ABSTRACT_METADATA_LEN]
            version = extract_arxiv_version(str(raw_id))
            content_hash = compute_paper_hash(title, abstract)

            vectors.append(
                {
                    "id": canonical_id,
                    "values": embedding,
                    "metadata": {
                        "arxiv_id": canonical_id,
                        "version": version,
                        "content_hash": content_hash,
                        "title": title,
                        "abstract": truncated_abstract,
                        "authors": self._to_csv(paper.get("authors")),
                        "published": str(paper.get("published", "")),
                        "categories": self._to_csv(paper.get("categories")),
                        "pdf_url": str(paper.get("pdf_url", "")),
                        "entry_url": str(paper.get("entry_url", "")),
                    },
                }
            )

        if not vectors:
            return 0

        # Upsert in batches to stay comfortably within Pinecone request-size limits.
        upserted = 0
        for i in range(0, len(vectors), _UPSERT_BATCH_SIZE):
            batch = vectors[i : i + _UPSERT_BATCH_SIZE]
            t0 = time.perf_counter()
            try:
                metrics.increment("pinecone_ops_total")
                response = self._index.upsert(vectors=batch, show_progress=False)
                metrics.record_latency("vector_upsert_ms", (time.perf_counter() - t0) * 1000.0)
                upserted += getattr(response, "upserted_count", len(batch))
            except Exception as exc:  # noqa: BLE001
                metrics.increment("pinecone_errors_total")
                logger.error("Pinecone upsert batch %d failed: %s", i // _UPSERT_BATCH_SIZE, exc)
                raise

        logger.debug("PineconeAdapter: upserted %d vectors", upserted)
        return upserted

    def fetch_records(self, ids: list[str]) -> dict[str, dict[str, Any]]:
        if not ids:
            return {}

        canonical_ids = list(dict.fromkeys(canonicalize_arxiv_id(fid) for fid in ids if fid))
        if not canonical_ids:
            return {}

        try:
            records: dict[str, dict[str, Any]] = {}
            for i in range(0, len(canonical_ids), _FETCH_BATCH_SIZE):
                batch = canonical_ids[i : i + _FETCH_BATCH_SIZE]
                res = self._index.fetch(ids=batch)
                vectors = getattr(res, "vectors", {}) or {}
                for vid, vec in vectors.items():
                    records[str(vid)] = {
                        "id": str(vid),
                        "metadata": dict(vec.metadata) if hasattr(vec, "metadata") and vec.metadata else {},
                    }
            return records
        except Exception as exc:  # noqa: BLE001
            logger.error("PineconeAdapter.fetch_records failed: %s", exc)
            return {}

    def query(
        self,
        query_vector: list[float],
        n_results: int,
        filter_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        # If filter_ids is explicitly an empty list, caller requested a search constrained
        # to an empty set of candidate IDs.
        if filter_ids is not None and len(filter_ids) == 0:
            return []

        filter_clause: dict[str, Any] | None = None
        safe_n = n_results

        if filter_ids is not None:
            canonical_ids = list(dict.fromkeys(canonicalize_arxiv_id(fid) for fid in filter_ids if fid))
            if not canonical_ids:
                return []
            safe_n = min(n_results, len(canonical_ids))
            filter_clause = {"arxiv_id": {"$in": canonical_ids}}

        if safe_n <= 0:
            return []

        query_kwargs: dict[str, Any] = {
            "vector": query_vector,
            "top_k": safe_n,
            "include_metadata": True,
            "include_values": False,
        }
        if filter_clause is not None:
            query_kwargs["filter"] = filter_clause

        t0 = time.perf_counter()
        try:
            metrics.increment("pinecone_ops_total")
            response = self._index.query(**query_kwargs)
            metrics.record_latency("vector_query_ms", (time.perf_counter() - t0) * 1000.0)
        except Exception as exc:  # noqa: BLE001
            metrics.increment("pinecone_errors_total")
            logger.error("Pinecone query failed: %s", exc)
            raise

        matches: list[dict[str, Any]] = []
        for match in getattr(response, "matches", []):
            matches.append(
                {
                    "id": str(match.id),
                    "score": float(match.score),
                    "metadata": dict(match.metadata) if match.metadata else {},
                }
            )

        # Pinecone returns results ranked by descending score, but sort explicitly to guarantee the contract.
        matches.sort(key=lambda m: m["score"], reverse=True)
        return matches

    def count(self) -> int:
        try:
            stats = self._index.describe_index_stats()
            return stats.total_vector_count
        except Exception:  # noqa: BLE001
            return 0

    def reset(self) -> None:
        """
        Delete all vectors from the index.

        This calls ``delete`` with ``delete_all=True`` on the default namespace.
        Use only in tests or controlled maintenance contexts.
        """
        try:
            self._index.delete(delete_all=True)
            logger.warning("PineconeAdapter.reset(): all vectors deleted from index %r", self._index_name)
        except Exception as exc:  # noqa: BLE001
            logger.error("PineconeAdapter.reset() failed: %s", exc)
            raise
