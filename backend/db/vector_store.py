"""
Abstract vector-store interface and utilities.

All adapters must implement this protocol so the rest of the application
remains decoupled from the concrete vector-store backend.

Query result format
-------------------
``query()`` returns a list of ranked matches in descending similarity order::

    [
        {
            "id":       str,            # canonical arxiv_id used as vector ID
            "score":    float,          # cosine similarity in [0, 1]; higher = more similar
            "metadata": dict[str, Any], # stored metadata fields
        },
        ...
    ]

Score convention: adapters are responsible for normalising their native
distance/similarity metric to a cosine-similarity value in [0, 1]:

* ChromaDB returns cosine distance → ``score = 1.0 - distance``
* Pinecone returns cosine similarity directly → ``score = raw_score``
"""

from __future__ import annotations

import hashlib
import re
from abc import ABC, abstractmethod
from typing import Any

_VERSION_SUFFIX_PATTERN = re.compile(r"v\d+$", re.IGNORECASE)
_EXTRACT_VERSION_PATTERN = re.compile(r"(v\d+)$", re.IGNORECASE)


def canonicalize_arxiv_id(arxiv_id: str) -> str:
    """
    Derive a stable, canonical arXiv ID by stripping any trailing version suffix
    (e.g., '2301.00001v2' -> '2301.00001', 'math/0211159v1' -> 'math/0211159').

    This policy guarantees:
    1. Deterministic vector IDs across queries and re-index passes.
    2. Updates to a paper overwrite the previous entry rather than creating duplicate vectors.
    3. Lookups with or without explicit version suffixes match the canonical record.
    """
    if not arxiv_id:
        return ""
    cleaned = str(arxiv_id).strip()
    return _VERSION_SUFFIX_PATTERN.sub("", cleaned)


def extract_arxiv_version(raw_id: str) -> str:
    """
    Extract the version suffix from an arXiv ID, e.g. '2301.00001v2' -> 'v2'.
    Returns 'v1' if no explicit version suffix is present.
    """
    if not raw_id:
        return "v1"
    match = _EXTRACT_VERSION_PATTERN.search(str(raw_id).strip())
    if match:
        return match.group(1).lower()
    return "v1"


def compute_paper_hash(title: str, abstract: str) -> str:
    """
    Compute a deterministic 16-character SHA-256 fingerprint of a paper's content.
    Used to detect meaningful metadata changes between arXiv revisions.
    """
    normalized = f"{title.strip().lower()} {abstract.strip().lower()}".encode("utf-8")
    return hashlib.sha256(normalized).hexdigest()[:16]


class VectorStore(ABC):
    """Minimal interface required by the Scholytics discovery & search pipeline."""

    @abstractmethod
    def upsert_papers(
        self,
        papers: list[dict[str, Any]],
        embeddings: list[list[float]],
    ) -> int:
        """
        Upsert *papers* with their pre-computed *embeddings*.

        ``papers`` and ``embeddings`` are parallel lists of the same length.
        Papers without an ``arxiv_id`` key are silently skipped.

        Returns the number of papers actually upserted.
        """

    @abstractmethod
    def fetch_records(self, ids: list[str]) -> dict[str, dict[str, Any]]:
        """
        Fetch existing records from the vector store by canonical arXiv IDs.

        Returns a dictionary mapping ``canonical_id -> {"id": str, "metadata": dict, ...}``.
        IDs not present in the vector store are omitted from the returned dict.
        """

    @abstractmethod
    def query(
        self,
        query_vector: list[float],
        n_results: int,
        filter_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """
        Return up to *n_results* matches ranked by descending cosine similarity.

        If *filter_ids* is provided, restricts the search to those vector IDs.
        If *filter_ids* is None or empty, searches across the entire indexed corpus.

        Each element is a dict with keys ``id``, ``score``, and ``metadata``.
        Returns an empty list when no matches are found.
        """

    @abstractmethod
    def count(self) -> int:
        """Return the total number of vectors currently stored."""

    @abstractmethod
    def reset(self) -> None:
        """Delete all stored vectors (used in tests and cold-start cleanup)."""
