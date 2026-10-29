"""
Pipeline runner for the existing Scholytics retrieval and ranking system.

Executes the identical candidate embedding, ChromaDB ephemeral indexing,
and vector similarity ranking pipeline used in production (routers/search.py)
without incurring external Groq LLM token costs or depending on UI layers.
"""
from __future__ import annotations

import os
import sys
import time
import uuid
from typing import Any

# Ensure backend modules are importable
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import chromadb
from services import embedder


class BaselineRetrievalPipeline:
    """
    Simulates the exact two-stage ranking pipeline of Scholytics:
    1. Dense embedding of candidate abstracts with FastEmbed (BAAI/bge-small-en-v1.5).
    2. Ephemeral ChromaDB indexing in cosine similarity space.
    3. Query embedding and vector retrieval.
    4. Distance-to-score transformation: relevance_score = 1 - cosine_distance.
    """

    def __init__(self, chroma_client: Any | None = None):
        self.chroma_client = chroma_client or chromadb.EphemeralClient()

    def run_query(
        self,
        query: str,
        candidates: list[dict[str, Any]],
        top_k: int = 10,
    ) -> dict[str, Any]:
        """
        Executes the retrieval pipeline over a candidate pool, measuring exact
        phase latencies and returning ranked candidate IDs and scores.
        """
        result_meta: dict[str, Any] = {
            "query": query,
            "status": "success",
            "error": None,
            "candidate_count": len(candidates),
            "latencies_ms": {
                "candidate_embedding": 0.0,
                "indexing": 0.0,
                "query_embedding": 0.0,
                "vector_query": 0.0,
                "total": 0.0,
            },
            "ranked_results": [],
            "retrieved_ids": [],
        }

        if not candidates:
            return result_meta

        start_total = time.perf_counter()

        # Step 1: Candidate text preparation
        prepared: list[tuple[dict[str, Any], str]] = []
        for paper in candidates:
            aid = str(paper.get("arxiv_id", "")).strip()
            if not aid:
                continue
            text = f"{paper.get('title', '')}. {paper.get('abstract', '')}".strip()
            prepared.append((paper, text))

        if not prepared:
            return result_meta

        # Step 2: Embed candidate documents
        try:
            t0 = time.perf_counter()
            texts = [text for _, text in prepared]
            embeddings = embedder.embed_texts(texts)
            result_meta["latencies_ms"]["candidate_embedding"] = (time.perf_counter() - t0) * 1000.0
        except Exception as exc:
            result_meta["status"] = "failure"
            result_meta["error"] = f"Candidate embedding failed: {exc}"
            result_meta["latencies_ms"]["total"] = (time.perf_counter() - start_total) * 1000.0
            return result_meta

        # Step 3: Index into ephemeral Chroma collection
        # Create an isolated collection per run to avoid cross-query contamination
        coll_name = f"eval_{uuid.uuid4().hex[:12]}"
        try:
            t0 = time.perf_counter()
            collection = self.chroma_client.get_or_create_collection(
                name=coll_name,
                metadata={"hnsw:space": "cosine"},
            )

            # Upsert candidates matching index_papers behavior
            for (paper, combined_text), embedding in zip(prepared, embeddings):
                collection.upsert(
                    ids=[str(paper["arxiv_id"])],
                    embeddings=[embedding],
                    documents=[combined_text],
                    metadatas=[
                        {
                            "arxiv_id": str(paper.get("arxiv_id", "")),
                            "title": str(paper.get("title", "")),
                            "published": str(paper.get("published", "")),
                        }
                    ],
                )
            result_meta["latencies_ms"]["indexing"] = (time.perf_counter() - t0) * 1000.0
        except Exception as exc:
            result_meta["status"] = "failure"
            result_meta["error"] = f"Indexing failed: {exc}"
            result_meta["latencies_ms"]["total"] = (time.perf_counter() - start_total) * 1000.0
            return result_meta

        # Step 4: Query embedding
        try:
            t0 = time.perf_counter()
            query_vector = embedder.embed_query(query)
            result_meta["latencies_ms"]["query_embedding"] = (time.perf_counter() - t0) * 1000.0
        except Exception as exc:
            result_meta["status"] = "failure"
            result_meta["error"] = f"Query embedding failed: {exc}"
            result_meta["latencies_ms"]["total"] = (time.perf_counter() - start_total) * 1000.0
            self._cleanup_collection(coll_name)
            return result_meta

        # Step 5: Vector search in ChromaDB
        try:
            t0 = time.perf_counter()
            fetched_ids = [str(p["arxiv_id"]) for p, _ in prepared]
            query_result = collection.query(
                query_embeddings=[query_vector],
                n_results=min(top_k, len(fetched_ids)),
                where={"arxiv_id": {"$in": fetched_ids}},
                include=["metadatas", "distances"],
            )
            result_meta["latencies_ms"]["vector_query"] = (time.perf_counter() - t0) * 1000.0

            ids = (query_result.get("ids") or [[]])[0]
            distances = (query_result.get("distances") or [[]])[0]

            ranked = []
            for idx, pid in enumerate(ids):
                dist = float(distances[idx]) if idx < len(distances) and distances[idx] is not None else 1.0
                score = max(0.0, min(1.0, 1.0 - dist))
                ranked.append({
                    "arxiv_id": str(pid),
                    "distance": dist,
                    "relevance_score": score,
                })

            ranked.sort(key=lambda x: x["relevance_score"], reverse=True)
            result_meta["ranked_results"] = ranked
            result_meta["retrieved_ids"] = [item["arxiv_id"] for item in ranked]

        except Exception as exc:
            result_meta["status"] = "failure"
            result_meta["error"] = f"Vector query failed: {exc}"
        finally:
            self._cleanup_collection(coll_name)

        result_meta["latencies_ms"]["total"] = (time.perf_counter() - start_total) * 1000.0
        return result_meta

    def _cleanup_collection(self, coll_name: str) -> None:
        try:
            self.chroma_client.delete_collection(name=coll_name)
        except Exception:
            pass

