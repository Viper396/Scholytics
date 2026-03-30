from __future__ import annotations

from typing import Any

import chromadb

_client: chromadb.EphemeralClient | None = None
_collection: Any | None = None


def get_collection():
	global _client, _collection

	if _collection is not None:
		return _collection

	if _client is None:
		_client = chromadb.EphemeralClient()

	_collection = _client.get_or_create_collection(
		name="research_papers",
		metadata={"hnsw:space": "cosine"},
	)
	return _collection
