"""
Legacy ChromaDB collection provider.

Maintained for backwards compatibility. New code should use the
VectorStore abstraction (db.vector_store.VectorStore and db.chroma_adapter.ChromaAdapter).
"""

from __future__ import annotations

from db.chroma_adapter import get_collection

__all__ = ["get_collection"]
