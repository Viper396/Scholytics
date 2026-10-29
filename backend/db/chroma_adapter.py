"""
ChromaDB adapter implementing the VectorStore interface.

Wraps the existing EphemeralClient singleton so the rest of the application
does not import chromadb directly. The adapter is the default backend used
in local development and CI (no external credentials required).
"""

from __future__ import annotations

import logging
from typing import Any

from db.vector_store import (
    VectorStore,
    canonicalize_arxiv_id,
    compute_paper_hash,
    extract_arxiv_version,
)

logger = logging.getLogger(__name__)

# Lazily-imported to avoid hard dependency at module load time.
_chromadb: Any = None
_client: Any = None
_collection: Any = None

_COLLECTION_NAME = "research_papers"


def _get_chromadb():
    global _chromadb
    if _chromadb is None:
        import chromadb as _cb  # noqa: PLC0415

        _chromadb = _cb
    return _chromadb


def _get_collection():
    global _client, _collection
    if _collection is not None:
        return _collection
    cb = _get_chromadb()
    if _client is None:
        _client = cb.EphemeralClient()
    _collection = _client.get_or_create_collection(
        name=_COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )
    return _collection


class ChromaAdapter(VectorStore):
    """Vector store backed by an in-process ChromaDB EphemeralClient."""

    def __init__(self) -> None:
        self._collection = _get_collection()

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

        count = 0
        for paper, embedding in zip(papers, embeddings):
            raw_id = paper.get("arxiv_id")
            if not raw_id:
                continue
            canonical_id = canonicalize_arxiv_id(str(raw_id))
            title = str(paper.get("title", ""))
            abstract = str(paper.get("abstract", ""))
            combined_text = f"{title}. {abstract}".strip()
            version = extract_arxiv_version(str(raw_id))
            content_hash = compute_paper_hash(title, abstract)

            self._collection.upsert(
                ids=[canonical_id],
                embeddings=[embedding],
                documents=[combined_text],
                metadatas=[
                    {
                        "arxiv_id": canonical_id,
                        "version": version,
                        "content_hash": content_hash,
                        "title": title,
                        "abstract": abstract[:2000],
                        "authors": _to_csv(paper.get("authors")),
                        "published": str(paper.get("published", "")),
                        "categories": _to_csv(paper.get("categories")),
                        "pdf_url": str(paper.get("pdf_url", "")),
                        "entry_url": str(paper.get("entry_url", "")),
                    }
                ],
            )
            count += 1

        logger.debug("ChromaAdapter: upserted %d papers", count)
        return count

    def fetch_records(self, ids: list[str]) -> dict[str, dict[str, Any]]:
        if not ids:
            return {}

        canonical_ids = list(dict.fromkeys(canonicalize_arxiv_id(fid) for fid in ids if fid))
        if not canonical_ids:
            return {}

        try:
            res = self._collection.get(ids=canonical_ids, include=["metadatas", "documents"])
            existing_ids = res.get("ids") or []
            metadatas = res.get("metadatas") or []
            documents = res.get("documents") or []

            records: dict[str, dict[str, Any]] = {}
            for idx, vid in enumerate(existing_ids):
                meta = metadatas[idx] if idx < len(metadatas) and metadatas[idx] else {}
                doc = documents[idx] if idx < len(documents) else ""
                records[str(vid)] = {
                    "id": str(vid),
                    "metadata": meta,
                    "document": doc,
                }
            return records
        except Exception as exc:  # noqa: BLE001
            logger.error("ChromaAdapter.fetch_records failed: %s", exc)
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

        where_clause: dict[str, Any] | None = None
        safe_n = n_results

        if filter_ids is not None:
            canonical_ids = list(dict.fromkeys(canonicalize_arxiv_id(fid) for fid in filter_ids if fid))
            if not canonical_ids:
                return []
            safe_n = min(n_results, len(canonical_ids))
            where_clause = {"arxiv_id": {"$in": canonical_ids}}
        else:
            total_stored = self.count()
            if total_stored <= 0:
                return []
            safe_n = min(n_results, total_stored)

        if safe_n <= 0:
            return []

        query_kwargs: dict[str, Any] = {
            "query_embeddings": [query_vector],
            "n_results": safe_n,
            "include": ["metadatas", "documents", "distances"],
        }
        if where_clause is not None:
            query_kwargs["where"] = where_clause

        result = self._collection.query(**query_kwargs)

        ids = (result.get("ids") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]
        metadatas = (result.get("metadatas") or [[]])[0]
        documents = (result.get("documents") or [[]])[0]

        matches: list[dict[str, Any]] = []
        for idx, vid in enumerate(ids):
            distance = float(distances[idx]) if idx < len(distances) and distances[idx] is not None else 1.0
            score = max(0.0, min(1.0, 1.0 - distance))  # cosine distance → similarity
            metadata = metadatas[idx] if idx < len(metadatas) and metadatas[idx] else {}
            doc = documents[idx] if idx < len(documents) else ""
            matches.append({
                "id": str(vid),
                "score": score,
                "metadata": metadata,
                "document": doc,
            })

        matches.sort(key=lambda m: m["score"], reverse=True)
        return matches

    def count(self) -> int:
        try:
            return self._collection.count()
        except Exception:  # noqa: BLE001
            return 0

    def reset(self) -> None:
        global _collection
        try:
            self._collection.delete(where={"arxiv_id": {"$ne": ""}})
        except Exception:  # noqa: BLE001
            # EphemeralClient: recreate the collection.
            if _client is not None:
                try:
                    _client.delete_collection(_COLLECTION_NAME)
                except Exception:  # noqa: BLE001
                    pass
                _collection = _client.get_or_create_collection(
                    name=_COLLECTION_NAME,
                    metadata={"hnsw:space": "cosine"},
                )
                self._collection = _collection


# ---------------------------------------------------------------------------
# Legacy compatibility shim
# ---------------------------------------------------------------------------

def get_collection():
    """Return the raw ChromaDB collection (legacy shim)."""
    return _get_collection()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _to_csv(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(str(item) for item in value)
    if value is None:
        return ""
    return str(value)
