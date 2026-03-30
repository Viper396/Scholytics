from __future__ import annotations

import os
from typing import Any

from sentence_transformers import SentenceTransformer

_MODEL_NAME = os.getenv("LOCAL_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
_MODEL = SentenceTransformer(_MODEL_NAME)


def _to_joined_string(value: Any) -> str:
	if isinstance(value, list):
		return ", ".join(str(item) for item in value)
	if value is None:
		return ""
	return str(value)


def embed_texts(texts: list[str]) -> list[list[float]]:
	if not texts:
		return []

	embeddings = _MODEL.encode(texts, normalize_embeddings=True)
	return [[float(v) for v in row] for row in embeddings.tolist()]


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
	embedding = _MODEL.encode(query, normalize_embeddings=True)
	return [float(v) for v in embedding.tolist()]
