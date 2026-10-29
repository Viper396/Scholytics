from __future__ import annotations

import hashlib
import logging
import math
import os
import re
from typing import Any

logger = logging.getLogger(__name__)

try:
	from fastembed import TextEmbedding
except Exception:  # noqa: BLE001
	TextEmbedding = None

_DEFAULT_MODEL_NAME = "BAAI/bge-small-en-v1.5"
_MODEL_NAME = os.getenv("LOCAL_EMBEDDING_MODEL", _DEFAULT_MODEL_NAME).strip() or _DEFAULT_MODEL_NAME
_HASH_DIM = 384
_MODEL = None

# Whether to allow the hash-based fallback (only in development/testing).
# Set USE_HASH_EMBEDDING_FALLBACK=true to opt in explicitly.
_ALLOW_HASH_FALLBACK = os.getenv("USE_HASH_EMBEDDING_FALLBACK", "false").strip().lower() == "true"

# Tracks whether we are currently in degraded (hash) mode.
_using_hash_fallback: bool = False


def _resolve_model_name() -> str:
	# Preserve backward compatibility with older env values from sentence-transformers.
	if _MODEL_NAME.startswith("sentence-transformers/"):
		return _DEFAULT_MODEL_NAME
	return _MODEL_NAME


def _get_model():
	global _MODEL, _using_hash_fallback
	if TextEmbedding is None:
		return None
	if _MODEL is None:
		try:
			_MODEL = TextEmbedding(model_name=_resolve_model_name())
			_using_hash_fallback = False
			logger.info("Embedding model loaded: %s", _resolve_model_name())
		except Exception as exc:  # noqa: BLE001
			logger.error("Failed to initialize embedding model %s: %s", _resolve_model_name(), exc)
			return None
	return _MODEL


def _normalize(vector: list[float]) -> list[float]:
	norm = math.sqrt(sum(value * value for value in vector))
	if norm == 0:
		return vector
	return [value / norm for value in vector]


def _to_joined_string(value: Any) -> str:
	if isinstance(value, list):
		return ", ".join(str(item) for item in value)
	if value is None:
		return ""
	return str(value)


def _hash_embed(text: str) -> list[float]:
	"""
	Deterministic hashing fallback — NOT semantic embedding.
	Only available when USE_HASH_EMBEDDING_FALLBACK=true.
	Results do not reflect semantic similarity and will produce
	unreliable ranking. Use only for development/offline testing.
	"""
	vector = [0.0] * _HASH_DIM
	tokens = re.findall(r"[A-Za-z0-9_]+", text.lower())
	for token in tokens:
		hash_value = int.from_bytes(
			hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest(),
			"big",
		)
		index = hash_value % _HASH_DIM
		sign = -1.0 if ((hash_value >> 1) & 1) else 1.0
		vector[index] += sign
	return _normalize(vector)


def is_using_hash_fallback() -> bool:
	"""Return True if we are operating in degraded hash-embedding mode."""
	return _using_hash_fallback


def embed_texts(texts: list[str]) -> list[list[float]]:
	"""
	Embed a list of texts using the configured FastEmbed model.

	Raises RuntimeError if the model is unavailable and hash fallback is not enabled.
	When fallback is enabled, logs a clear warning and returns hash-based vectors.
	Hash embeddings do NOT provide semantic similarity — rankings will be unreliable.
	"""
	global _using_hash_fallback

	if not texts:
		return []

	if TextEmbedding is not None:
		model = _get_model()
		if model is not None:
			try:
				embeddings = list(model.embed(texts))
				_using_hash_fallback = False
				return [_normalize([float(v) for v in row.tolist()]) for row in embeddings]
			except Exception as exc:  # noqa: BLE001
				logger.error("Embedding generation failed: %s", exc)

	# Real model failed or is unavailable.
	if _ALLOW_HASH_FALLBACK:
		_using_hash_fallback = True
		logger.warning(
			"DEGRADED MODE: Using hash-based embeddings instead of semantic embeddings. "
			"Search ranking will be unreliable. "
			"Set USE_HASH_EMBEDDING_FALLBACK=false to disable this fallback."
		)
		return [_hash_embed(text) for text in texts]

	# No fallback allowed — surface the error clearly.
	raise RuntimeError(
		"Embedding model is unavailable and hash fallback is disabled. "
		"Ensure the fastembed package is installed and the model can be loaded. "
		"To allow degraded offline operation set USE_HASH_EMBEDDING_FALLBACK=true."
	)


def index_papers(papers: list[dict], vector_store) -> int:
	"""
	Embed *papers* and upsert them into *vector_store*.

	*vector_store* must implement the ``VectorStore`` interface
	(``db.vector_store.VectorStore``).  This signature replaces the previous
	API that accepted a raw ChromaDB collection object.

	Returns the number of papers actually indexed.
	Raises ``RuntimeError`` if embedding fails and the hash fallback is disabled.
	"""
	if not papers:
		return 0

	prepared: list[tuple[dict, str]] = []
	for paper in papers:
		arxiv_id = paper.get("arxiv_id")
		if not arxiv_id:
			continue
		combined_text = f"{paper.get('title', '')}. {paper.get('abstract', '')}".strip()
		prepared.append((paper, combined_text))

	if not prepared:
		return 0

	embeddings = embed_texts([combined_text for _, combined_text in prepared])
	indexed_papers = [paper for paper, _ in prepared]

	return vector_store.upsert_papers(indexed_papers, embeddings)


def embed_query(query: str) -> list[float]:
	embeddings = embed_texts([query])
	if not embeddings:
		return []
	return embeddings[0]
