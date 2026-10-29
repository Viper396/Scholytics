"""
Hybrid (Dense + BM25) retrieval pipeline runner for evaluation and parameter tuning.

Executes:
1. Dense-only retrieval using FastEmbed and Chroma/Pinecone.
2. Keyword-only retrieval using BM25Index.
3. Hybrid retrieval combining both rankings via Reciprocal Rank Fusion (RRF).

Measures phase latencies (dense embedding, BM25 indexing, BM25 query, RRF fusion).
"""

from __future__ import annotations

import os
import sys
import time
import uuid
from typing import Any, Literal

# Ensure backend modules are importable
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import chromadb
from services import embedder
from services.bm25 import BM25Index
from services.fusion import reciprocal_rank_fusion


class HybridRetrievalPipeline:
    """
    Simulates retrieval across dense, keyword, and hybrid modalities:
    - Dense: FastEmbed (BAAI/bge-small-en-v1.5) dense vectors with cosine similarity.
    - Keyword: Lightweight in-memory Okapi BM25+.
    - Hybrid: Reciprocal Rank Fusion (RRF) with configurable smoothing k and weights.
    """

    def __init__(
        self,
        chroma_client: Any | None = None,
        rrf_k: float = 60.0,
        weight_dense: float = 1.0,
        weight_keyword: float = 1.0,
        bm25_k1: float = 1.5,
        bm25_b: float = 0.75,
    ) -> None:
        self.chroma_client = chroma_client or chromadb.EphemeralClient()
        self.rrf_k = rrf_k
        self.weight_dense = weight_dense
        self.weight_keyword = weight_keyword
        self.bm25_k1 = bm25_k1
        self.bm25_b = bm25_b

    def run_query(
        self,
        query: str,
        candidates: list[dict[str, Any]],
        top_k: int = 10,
        mode: Literal["dense", "keyword", "hybrid"] = "hybrid",
    ) -> dict[str, Any]:
        """
        Execute retrieval under specified mode ('dense', 'keyword', or 'hybrid').
        """
        result_meta: dict[str, Any] = {
            "query": query,
            "mode": mode,
            "status": "success",
            "error": None,
            "candidate_count": len(candidates),
            "latencies_ms": {
                "dense_embedding": 0.0,
                "dense_indexing": 0.0,
                "dense_query": 0.0,
                "bm25_indexing": 0.0,
                "bm25_query": 0.0,
                "fusion": 0.0,
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

        dense_ranked: list[dict[str, Any]] = []
        bm25_ranked: list[dict[str, Any]] = []

        # ==============================================================
        # 1. Dense Retrieval Path (executed for 'dense' and 'hybrid')
        # ==============================================================
        if mode in ("dense", "hybrid"):
            coll_name = f"eval_{uuid.uuid4().hex[:12]}"
            try:
                # Embed candidates
                t0 = time.perf_counter()
                texts = [text for _, text in prepared]
                embeddings = embedder.embed_texts(texts)
                result_meta["latencies_ms"]["dense_embedding"] = (time.perf_counter() - t0) * 1000.0

                # Index into Chroma
                t0 = time.perf_counter()
                collection = self.chroma_client.get_or_create_collection(
                    name=coll_name,
                    metadata={"hnsw:space": "cosine"},
                )
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
                result_meta["latencies_ms"]["dense_indexing"] = (time.perf_counter() - t0) * 1000.0

                # Query vector
                t0 = time.perf_counter()
                query_vector = embedder.embed_query(query)
                fetched_ids = [str(p["arxiv_id"]) for p, _ in prepared]
                query_result = collection.query(
                    query_embeddings=[query_vector],
                    n_results=len(fetched_ids),
                    where={"arxiv_id": {"$in": fetched_ids}},
                    include=["metadatas", "distances"],
                )
                result_meta["latencies_ms"]["dense_query"] = (time.perf_counter() - t0) * 1000.0

                ids = (query_result.get("ids") or [[]])[0]
                distances = (query_result.get("distances") or [[]])[0]
                metadatas = (query_result.get("metadatas") or [[]])[0]

                for idx, pid in enumerate(ids):
                    dist = float(distances[idx]) if idx < len(distances) and distances[idx] is not None else 1.0
                    score = max(0.0, min(1.0, 1.0 - dist))
                    meta = metadatas[idx] if idx < len(metadatas) and metadatas[idx] else {}
                    dense_ranked.append({
                        "id": str(pid),
                        "score": score,
                        "metadata": meta,
                    })
                dense_ranked.sort(key=lambda x: x["score"], reverse=True)

            except Exception as exc:
                result_meta["status"] = "failure"
                result_meta["error"] = f"Dense retrieval failed: {exc}"
                result_meta["latencies_ms"]["total"] = (time.perf_counter() - start_total) * 1000.0
                return result_meta
            finally:
                try:
                    self.chroma_client.delete_collection(name=coll_name)
                except Exception:
                    pass

        # ==============================================================
        # 2. Keyword Retrieval Path (BM25) (executed for 'keyword' and 'hybrid')
        # ==============================================================
        if mode in ("keyword", "hybrid"):
            try:
                bm25_index = BM25Index(k1=self.bm25_k1, b=self.bm25_b)
                t0 = time.perf_counter()
                for paper, text in prepared:
                    bm25_index.add_document(
                        doc_id=str(paper["arxiv_id"]),
                        text=text,
                        metadata=paper,
                    )
                result_meta["latencies_ms"]["bm25_indexing"] = (time.perf_counter() - t0) * 1000.0

                t0 = time.perf_counter()
                bm25_ranked = bm25_index.search(
                    query=query,
                    top_k=len(prepared),
                    filter_ids=[str(p["arxiv_id"]) for p, _ in prepared],
                )
                result_meta["latencies_ms"]["bm25_query"] = (time.perf_counter() - t0) * 1000.0

            except Exception as exc:
                result_meta["status"] = "failure"
                result_meta["error"] = f"BM25 retrieval failed: {exc}"
                result_meta["latencies_ms"]["total"] = (time.perf_counter() - start_total) * 1000.0
                return result_meta

        # ==============================================================
        # 3. Mode Resolution & Ranking Fusion
        # ==============================================================
        if mode == "dense":
            final_ranked = dense_ranked[:top_k]
        elif mode == "keyword":
            final_ranked = bm25_ranked[:top_k]
        else:
            # Hybrid: Reciprocal Rank Fusion
            t0 = time.perf_counter()
            final_ranked = reciprocal_rank_fusion(
                dense_results=dense_ranked,
                keyword_results=bm25_ranked,
                k=self.rrf_k,
                weight_dense=self.weight_dense,
                weight_keyword=self.weight_keyword,
                top_k=top_k,
            )
            result_meta["latencies_ms"]["fusion"] = (time.perf_counter() - t0) * 1000.0

        result_meta["ranked_results"] = final_ranked
        result_meta["retrieved_ids"] = [item["id"] for item in final_ranked]
        result_meta["latencies_ms"]["total"] = (time.perf_counter() - start_total) * 1000.0
        return result_meta
