from __future__ import annotations

import math
import os
from typing import Any

from fastembed import TextEmbedding

_DEFAULT_MODEL_NAME = "BAAI/bge-small-en-v1.5"
_MODEL_NAME = os.getenv("LOCAL_EMBEDDING_MODEL", _DEFAULT_MODEL_NAME).strip() or _DEFAULT_MODEL_NAME
_MODEL: TextEmbedding | None = None


def _resolve_model_name() -> str:
	# Preserve backward compatibility with older env values from sentence-transformers.
	if _MODEL_NAME.startswith("sentence-transformers/"):
		return _DEFAULT_MODEL_NAME
	return _MODEL_NAME


def _get_model() -> TextEmbedding:
	global _MODEL
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


def embed_texts(texts: list[str]) -> list[list[float]]:
	if not texts:
		return []

	model = _get_model()
	embeddings = list(model.embed(texts))
	return [_normalize([float(v) for v in row.tolist()]) for row in embeddings]


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
	model = _get_model()
	embeddings = list(model.embed([query]))
	if not embeddings:
		return []
	return _normalize([float(v) for v in embeddings[0].tolist()])
