"""
Profiling script to benchmark individual stages of Scholytics:
1. arXiv search request latency
2. arXiv fetch paper by ID latency
3. Query embedding latency (FastEmbed CPU)
4. Paper batch embedding latency (FastEmbed CPU)
5. Vector store fetch_records latency
6. Vector store query latency
7. Groq summarization latency (if GROQ_API_KEY available)
8. Groq synthesis streaming TTFT & total duration (if GROQ_API_KEY available)
9. Reranker latency (if enabled)
10. End-to-end /api/search pipeline latency
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

# Ensure backend modules can be imported
backend_path = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(backend_path))

from dotenv import load_dotenv

load_dotenv()
load_dotenv(Path(__file__).parent.parent / ".env")

from db.chroma_adapter import ChromaAdapter
from services import arxiv_client, embedder, fusion, reranker, summarizer
from services.bm25 import BM25Index


def _format_stats(latencies_ms: list[float]) -> dict[str, float]:
    if not latencies_ms:
        return {"min": 0.0, "mean": 0.0, "p50": 0.0, "p95": 0.0, "max": 0.0}
    sorted_l = sorted(latencies_ms)
    n = len(sorted_l)
    p50_idx = int(n * 0.50)
    p95_idx = min(n - 1, int(n * 0.95))
    return {
        "min": round(sorted_l[0], 2),
        "mean": round(sum(sorted_l) / n, 2),
        "p50": round(sorted_l[p50_idx], 2),
        "p95": round(sorted_l[p95_idx], 2),
        "max": round(sorted_l[-1], 2),
    }


def profile_stage_embedding() -> dict[str, Any]:
    print("[1/6] Profiling FastEmbed Embedding latency...")
    # Warm up
    embedder.warm_up()

    # Query embedding (single text)
    queries = [
        "quantum computing error mitigation",
        "retrieval augmented generation evaluation",
        "transformer attention efficiency",
        "self-supervised visual representation",
        "reinforcement learning from human feedback",
    ]
    query_latencies = []
    for q in queries * 3:
        t0 = time.perf_counter()
        _ = embedder.embed_query(q)
        query_latencies.append((time.perf_counter() - t0) * 1000)

    # Paper batch embedding (10 candidate papers)
    sample_text = (
        "We present an empirical study of low-rank adaptation techniques in large language models. "
        "Our experiments evaluate zero-shot reasoning benchmarks and measure parameter efficiency, "
        "showing substantial reduction in training compute while maintaining downstream accuracy."
    )
    batch_latencies = []
    for _ in range(5):
        t0 = time.perf_counter()
        _ = embedder.embed_texts([f"Paper {i}: {sample_text}" for i in range(10)])
        batch_latencies.append((time.perf_counter() - t0) * 1000)

    return {
        "query_embedding_ms": _format_stats(query_latencies),
        "batch_10_papers_embedding_ms": _format_stats(batch_latencies),
    }


def profile_stage_vector_store() -> dict[str, Any]:
    print("[2/6] Profiling Vector Store latency (Chroma Ephemeral / Pinecone)...")
    store = ChromaAdapter()
    sample_vecs = [[0.05 * (i + j) % 1.0 for j in range(384)] for i in range(10)]
    sample_papers = [
        {
            "arxiv_id": f"2401.{10000 + i}",
            "title": f"Test Title {i}",
            "abstract": f"Test Abstract {i}",
            "authors": ["Author A"],
            "published": "2024-01-01",
        }
        for i in range(10)
    ]
    store.upsert_papers(sample_papers, sample_vecs)

    # Query latency
    query_vec = [0.1] * 384
    query_latencies = []
    for _ in range(15):
        t0 = time.perf_counter()
        _ = store.query(query_vec, n_results=5)
        query_latencies.append((time.perf_counter() - t0) * 1000)

    # Fetch records latency
    fetch_latencies = []
    ids_to_fetch = [f"2401.{10000 + i}" for i in range(5)]
    for _ in range(15):
        t0 = time.perf_counter()
        _ = store.fetch_records(ids_to_fetch)
        fetch_latencies.append((time.perf_counter() - t0) * 1000)

    return {
        "vector_query_ms": _format_stats(query_latencies),
        "vector_fetch_records_ms": _format_stats(fetch_latencies),
    }


def profile_stage_bm25() -> dict[str, Any]:
    print("[3/6] Profiling BM25 Index latency...")
    bm = BM25Index()
    for i in range(25):
        bm.add_document(
            doc_id=f"doc_{i}",
            text=f"Retrieval augmented generation with dense vector embeddings and BM25 index number {i}",
            metadata={"arxiv_id": f"2401.{i}"},
        )
    latencies = []
    for q in ["retrieval generation", "dense vector", "index search", "augmented"]:
        for _ in range(5):
            t0 = time.perf_counter()
            _ = bm.search(q, top_k=5)
            latencies.append((time.perf_counter() - t0) * 1000)

    return {
        "bm25_search_ms": _format_stats(latencies),
    }


def profile_stage_arxiv_network() -> dict[str, Any]:
    print("[4/6] Profiling live arXiv network latency...")
    search_queries = [
        "quantum computing",
        "retrieval augmented generation",
        "vision transformer",
    ]
    search_latencies = []
    for q in search_queries:
        try:
            t0 = time.perf_counter()
            res = arxiv_client.search_papers(query=q, max_results=5)
            search_latencies.append((time.perf_counter() - t0) * 1000)
            time.sleep(1.0)  # Respect arXiv rate limit during profiling
        except Exception as exc:
            print(f"arXiv search error for {q}: {exc}")

    fetch_ids = ["2301.00001", "2401.00002"]
    fetch_latencies = []
    for aid in fetch_ids:
        try:
            t0 = time.perf_counter()
            _ = arxiv_client.fetch_paper_by_id(aid)
            fetch_latencies.append((time.perf_counter() - t0) * 1000)
            time.sleep(1.0)
        except Exception as exc:
            print(f"arXiv fetch error for {aid}: {exc}")

    return {
        "arxiv_search_network_ms": _format_stats(search_latencies),
        "arxiv_fetch_id_network_ms": _format_stats(fetch_latencies),
    }


def profile_stage_reranker() -> dict[str, Any]:
    print("[5/6] Profiling Reranker latency (if enabled)...")
    if not reranker.is_reranker_enabled():
        return {"status": "disabled", "rerank_10_candidates_ms": None}

    candidates = [
        {
            "id": f"c_{i}",
            "title": f"Candidate Paper Title {i}",
            "abstract": f"Candidate abstract for paper {i} discussing retrieval-augmented generation and search.",
            "score": 0.5 + (i * 0.03),
            "metadata": {},
        }
        for i in range(10)
    ]
    latencies = []
    for _ in range(3):
        t0 = time.perf_counter()
        _ = reranker.rerank("retrieval augmented generation", candidates, top_k=5)
        latencies.append((time.perf_counter() - t0) * 1000)

    return {
        "status": "enabled",
        "rerank_10_candidates_ms": _format_stats(latencies),
    }


def profile_stage_groq() -> dict[str, Any]:
    print("[6/6] Profiling Groq LLM latency...")
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    if not groq_key:
        return {
            "status": "no_api_key",
            "summarize_ms": None,
            "synthesis_ttft_ms": None,
            "synthesis_total_ms": None,
        }

    # Profile paper summarization
    summary_latencies = []
    try:
        t0 = time.perf_counter()
        _ = summarizer.summarize_paper(
            title="Attention Is All You Need",
            abstract="The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose the Transformer.",
        )
        summary_latencies.append((time.perf_counter() - t0) * 1000)
    except Exception as exc:
        print(f"Groq summarize error: {exc}")

    # Profile streaming synthesis TTFT and total duration
    ttft_ms = None
    total_ms = None
    try:
        sample_papers = [
            {
                "arxiv_id": "1706.03762",
                "title": "Attention Is All You Need",
                "abstract": "We propose the Transformer, a model architecture eschewing recurrence and instead relying entirely on an attention mechanism.",
                "authors": ["Ashish Vaswani", "Noam Shazeer"],
                "published": "2017-06-12",
            }
        ]
        t0 = time.perf_counter()
        stream = summarizer.generate_search_summary(
            query="Transformer attention mechanism",
            papers=sample_papers,
        )
        first_token = True
        for chunk in stream:
            if first_token:
                ttft_ms = round((time.perf_counter() - t0) * 1000, 2)
                first_token = False
        total_ms = round((time.perf_counter() - t0) * 1000, 2)
    except Exception as exc:
        print(f"Groq synthesis error: {exc}")

    return {
        "status": "ok",
        "summarize_ms": _format_stats(summary_latencies) if summary_latencies else None,
        "synthesis_ttft_ms": ttft_ms,
        "synthesis_total_ms": total_ms,
    }


def main():
    print("=== SCHOLYTICS STAGE-BY-STAGE LATENCY PROFILER ===")
    results = {}
    results["embedding"] = profile_stage_embedding()
    results["vector_store"] = profile_stage_vector_store()
    results["bm25"] = profile_stage_bm25()
    results["arxiv_network"] = profile_stage_arxiv_network()
    results["reranker"] = profile_stage_reranker()
    results["groq"] = profile_stage_groq()

    out_file = Path(__file__).parent / "results" / "baseline_stage_profiling.json"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(json.dumps(results, indent=2))
    print(f"\nProfiling completed! Saved to {out_file}")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
