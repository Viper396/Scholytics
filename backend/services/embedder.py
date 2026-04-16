from __future__ import annotations

import hashlib
import math
import os
import re
from typing import Any

try:
	from fastembed import TextEmbedding
except Exception:
	TextEmbedding = None

_DEFAULT_MODEL_NAME = "BAAI/bge-small-en-v1.5"
_MODEL_NAME = os.getenv("LOCAL_EMBEDDING_MODEL", _DEFAULT_MODEL_NAME).strip() or _DEFAULT_MODEL_NAME
_HASH_DIM = 384
_MODEL = None


def _resolve_model_name() -> str:
	# Preserve backward compatibility with older env values from sentence-transformers.
	if _MODEL_NAME.startswith("sentence-transformers/"):
		return _DEFAULT_MODEL_NAME
	return _MODEL_NAME


def _get_model():
	global _MODEL
	if TextEmbedding is None:
		return None
	if _MODEL is None:
		_MODEL = TextEmbedding(model_name=_resolve_model_name())
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


def embed_texts(texts: list[str]) -> list[list[float]]:
	if not texts:
		return []

	if TextEmbedding is not None:
		try:
			model = _get_model()
			if model is not None:
				embeddings = list(model.embed(texts))
				return [_normalize([float(v) for v in row.tolist()]) for row in embeddings]
		except Exception:
			pass

	return [_hash_embed(text) for text in texts]


def index_papers(papers: list[dict], collection) -> int:
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

	indexed_count = 0
	for (paper, combined_text), embedding in zip(prepared, embeddings):
		collection.upsert(
			ids=[str(paper.get("arxiv_id", ""))],
			embeddings=[embedding],
			documents=[combined_text],
			metadatas=[
				{
					"arxiv_id": str(paper.get("arxiv_id", "")),
					"title": str(paper.get("title", "")),
					"authors": _to_joined_string(paper.get("authors")),
					"published": str(paper.get("published", "")),
					"categories": _to_joined_string(paper.get("categories")),
					"pdf_url": str(paper.get("pdf_url", "")),
					"entry_url": str(paper.get("entry_url", "")),
				}
			],
		)
		indexed_count += 1

	return indexed_count


def embed_query(query: str) -> list[float]:
	embeddings = embed_texts([query])
	if not embeddings:
		return []
	return embeddings[0]
