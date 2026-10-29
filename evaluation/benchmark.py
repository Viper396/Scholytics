"""
CLI Benchmark Runner for Scholytics Baseline Retrieval Pipeline.

Executes reproducible retrieval benchmarks on the curated dataset,
calculates IR metrics (P@K, R@K, MRR, nDCG@K), records latency percentiles,
and outputs both machine-readable JSON and human-readable Markdown reports.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
from typing import Any

# Ensure current directory is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from evaluation.metrics import ndcg_at_k, precision_at_k, recall_at_k, reciprocal_rank
from evaluation.pipeline_runner import BaselineRetrievalPipeline


def percentile(values: list[float], p: float) -> float:
    """Computes the p-th percentile of a list of floats (0 <= p <= 100)."""
    if not values:
        return 0.0
    sorted_vals = sorted(values)
    k = (len(sorted_vals) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    d = k - f
    return sorted_vals[f] + d * (sorted_vals[c] - sorted_vals[f])


def evaluate_dataset(
    dataset_path: str,
    relevance_threshold: int = 2,
    pipeline: BaselineRetrievalPipeline | None = None,
) -> dict[str, Any]:
    """
    Evaluates the full dataset and returns comprehensive benchmark results.
    """
    with open(dataset_path, encoding="utf-8") as f:
        dataset = json.load(f)

    runner = pipeline or BaselineRetrievalPipeline()
    queries = dataset.get("queries", [])
    total_queries = len(queries)

    per_query_results = []
    latencies = {
        "candidate_embedding": [],
        "indexing": [],
        "query_embedding": [],
        "vector_query": [],
        "total": [],
    }

    p_at_1_list = []
    p_at_3_list = []
    p_at_5_list = []
    r_at_1_list = []
    r_at_3_list = []
    r_at_5_list = []
    rr_list = []
    ndcg_at_3_list = []
    ndcg_at_5_list = []

    success_count = 0
    failure_count = 0

    for query_item in queries:
        query_id = query_item["query_id"]
        query_text = query_item["query"]
        candidates = query_item.get("candidate_pool", [])
        ground_truth_list = query_item.get("ground_truth", [])

        # Ground truth mapping: arxiv_id -> relevance grade
        gt_map = {item["arxiv_id"]: int(item["relevance"]) for item in ground_truth_list}

        # Execute retrieval
        run_res = runner.run_query(query=query_text, candidates=candidates, top_k=len(candidates))

        if run_res["status"] == "success":
            success_count += 1
            retrieved_ids = run_res["retrieved_ids"]

            p1 = precision_at_k(retrieved_ids, gt_map, k=1, relevance_threshold=relevance_threshold)
            p3 = precision_at_k(retrieved_ids, gt_map, k=3, relevance_threshold=relevance_threshold)
            p5 = precision_at_k(retrieved_ids, gt_map, k=5, relevance_threshold=relevance_threshold)

            r1 = recall_at_k(retrieved_ids, gt_map, k=1, relevance_threshold=relevance_threshold)
            r3 = recall_at_k(retrieved_ids, gt_map, k=3, relevance_threshold=relevance_threshold)
            r5 = recall_at_k(retrieved_ids, gt_map, k=5, relevance_threshold=relevance_threshold)

            rr = reciprocal_rank(retrieved_ids, gt_map, relevance_threshold=relevance_threshold)

            ndcg3 = ndcg_at_k(retrieved_ids, gt_map, k=3)
            ndcg5 = ndcg_at_k(retrieved_ids, gt_map, k=5)

            p_at_1_list.append(p1)
            p_at_3_list.append(p3)
            p_at_5_list.append(p5)
            r_at_1_list.append(r1)
            r_at_3_list.append(r3)
            r_at_5_list.append(r5)
            rr_list.append(rr)
            ndcg_at_3_list.append(ndcg3)
            ndcg_at_5_list.append(ndcg5)

            for key in latencies:
                latencies[key].append(run_res["latencies_ms"][key])

            per_query_results.append({
                "query_id": query_id,
                "query": query_text,
                "domain": query_item.get("domain", "General"),
                "status": "success",
                "retrieved_count": len(retrieved_ids),
                "metrics": {
                    "p@1": p1,
                    "p@3": p3,
                    "p@5": p5,
                    "r@1": r1,
                    "r@3": r3,
                    "r@5": r5,
                    "mrr": rr,
                    "ndcg@3": ndcg3,
                    "ndcg@5": ndcg5,
                },
                "latencies_ms": run_res["latencies_ms"],
                "ranked_results": run_res["ranked_results"],
            })
        else:
            failure_count += 1
            per_query_results.append({
                "query_id": query_id,
                "query": query_text,
                "domain": query_item.get("domain", "General"),
                "status": "failure",
                "error": run_res["error"],
                "metrics": {
                    "p@1": 0.0, "p@3": 0.0, "p@5": 0.0,
                    "r@1": 0.0, "r@3": 0.0, "r@5": 0.0,
                    "mrr": 0.0, "ndcg@3": 0.0, "ndcg@5": 0.0,
                },
                "latencies_ms": run_res["latencies_ms"],
                "ranked_results": [],
            })

    def mean(lst: list[float]) -> float:
        return sum(lst) / len(lst) if lst else 0.0

    macro_metrics = {
        "mean_precision@1": mean(p_at_1_list),
        "mean_precision@3": mean(p_at_3_list),
        "mean_precision@5": mean(p_at_5_list),
        "mean_recall@1": mean(r_at_1_list),
        "mean_recall@3": mean(r_at_3_list),
        "mean_recall@5": mean(r_at_5_list),
        "mean_reciprocal_rank": mean(rr_list),
        "mean_ndcg@3": mean(ndcg_at_3_list),
        "mean_ndcg@5": mean(ndcg_at_5_list),
    }

    latency_summary = {}
    for key, vals in latencies.items():
        latency_summary[key] = {
            "mean_ms": round(mean(vals), 2),
            "p50_ms": round(percentile(vals, 50.0), 2),
            "p95_ms": round(percentile(vals, 95.0), 2),
            "min_ms": round(min(vals), 2) if vals else 0.0,
            "max_ms": round(max(vals), 2) if vals else 0.0,
        }

    return {
        "metadata": {
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "pipeline": "FastEmbed (BAAI/bge-small-en-v1.5) + ChromaDB EphemeralClient (cosine)",
            "vector_dimension": 384,
            "relevance_threshold": relevance_threshold,
            "total_queries": total_queries,
            "successful_queries": success_count,
            "failed_queries": failure_count,
            "failure_rate": round(failure_count / total_queries if total_queries else 0.0, 4),
        },
        "macro_metrics": macro_metrics,
        "latencies": latency_summary,
        "per_query_results": per_query_results,
    }


def generate_markdown_report(results: dict[str, Any]) -> str:
    """Formats benchmark results into a structured human-readable Markdown report."""
    meta = results["metadata"]
    metrics = results["macro_metrics"]
    lat = results["latencies"]
    queries = results["per_query_results"]

    md = []
    md.append("# Scholytics Baseline Retrieval Evaluation Report")
    md.append("")
    md.append(f"**Execution Timestamp**: `{meta['timestamp']}`  ")
    md.append(f"**Pipeline**: `{meta['pipeline']}`  ")
    md.append(f"**Dense Vector Dimension**: `{meta['vector_dimension']}`  ")
    md.append(f"**Total Queries**: `{meta['total_queries']}` | **Failure Rate**: `{meta['failure_rate'] * 100:.1f}%`  ")
    md.append(f"**Binary Relevance Grade Threshold**: `>= {meta['relevance_threshold']}` (Grades: 3=Highly Relevant, 2=Relevant, 1=Marginal, 0=Irrelevant)  ")
    md.append("")
    md.append("---")
    md.append("")
    md.append("## 1. Aggregate Macro Quality Metrics")
    md.append("")
    md.append("| Metric | Value | Description |")
    md.append("| :--- | :---: | :--- |")
    md.append(f"| **Precision@1** | **{metrics['mean_precision@1']:.4f}** | Fraction of queries whose #1 result is relevant |")
    md.append(f"| **Precision@3** | **{metrics['mean_precision@3']:.4f}** | Fraction of top 3 results that are relevant |")
    md.append(f"| **Precision@5** | **{metrics['mean_precision@5']:.4f}** | Fraction of top 5 results that are relevant |")
    md.append(f"| **Recall@1** | **{metrics['mean_recall@1']:.4f}** | Proportion of total relevant papers captured at rank 1 |")
    md.append(f"| **Recall@3** | **{metrics['mean_recall@3']:.4f}** | Proportion of total relevant papers captured at rank 3 |")
    md.append(f"| **Recall@5** | **{metrics['mean_recall@5']:.4f}** | Proportion of total relevant papers captured at rank 5 |")
    md.append(f"| **MRR** | **{metrics['mean_reciprocal_rank']:.4f}** | Mean Reciprocal Rank of first relevant document |")
    md.append(f"| **nDCG@3** | **{metrics['mean_ndcg@3']:.4f}** | Normalized Discounted Cumulative Gain at rank 3 |")
    md.append(f"| **nDCG@5** | **{metrics['mean_ndcg@5']:.4f}** | Normalized Discounted Cumulative Gain at rank 5 |")
    md.append("")
    md.append("---")
    md.append("")
    md.append("## 2. Latency Profile (Empirical)")
    md.append("")
    md.append("| Stage | Mean (ms) | Median (p50) | 95th Percentile (p95) | Min (ms) | Max (ms) |")
    md.append("| :--- | :---: | :---: | :---: | :---: | :---: |")
    for stage, name in [
        ("candidate_embedding", "Candidate Embedding (FastEmbed ONNX)"),
        ("indexing", "Vector Upsert (ChromaDB Ephemeral)"),
        ("query_embedding", "Query Embedding (FastEmbed)"),
        ("vector_query", "Vector Query & Cosine Ranking"),
        ("total", "Total Pipeline Latency"),
    ]:
        row = lat[stage]
        md.append(f"| **{name}** | {row['mean_ms']} ms | {row['p50_ms']} ms | {row['p95_ms']} ms | {row['min_ms']} ms | {row['max_ms']} ms |")
    md.append("")
    md.append("---")
    md.append("")
    md.append("## 3. Per-Query Performance Breakdown")
    md.append("")
    md.append("| ID | Query | Domain | P@3 | R@3 | MRR | nDCG@3 | Latency (ms) |")
    md.append("| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |")
    for q in queries:
        m = q["metrics"]
        tot_lat = q["latencies_ms"]["total"]
        md.append(f"| `{q['query_id']}` | {q['query']} | {q['domain']} | {m['p@3']:.2f} | {m['r@3']:.2f} | {m['mrr']:.2f} | {m['ndcg@3']:.4f} | {tot_lat:.1f} ms |")
    md.append("")
    md.append("---")
    md.append("")
    md.append("## 4. Methodology & Ground Truth Labeling")
    md.append("")
    md.append("1. **Relevance Scale**: Graded relevance on a 4-point scale ($0$ to $3$):")
    md.append("   - **3 (Highly Relevant)**: Canonical literature establishing or directly answering the query topic.")
    md.append("   - **2 (Relevant)**: Direct contribution or substantial algorithmic development on the query topic.")
    md.append("   - **1 (Marginal)**: Foundational precursor architecture (e.g. standard Transformers for CV queries) or broader contextual work.")
    md.append("   - **0 (Irrelevant)**: Cross-domain, distinct task formulation, or distractor candidate.")
    md.append("2. **Label Verification**: All relevance grades were manually verified against canonical literature definitions and peer-reviewed abstracts.")
    md.append("3. **Zero Token Consumption**: The benchmark evaluates embedding and vector search deterministically without calling Groq LLM APIs.")
    md.append("")
    return "\n".join(md)


def main():
    parser = argparse.ArgumentParser(description="Scholytics Retrieval Baseline Benchmark")
    parser.add_argument(
        "--dataset",
        default="evaluation/dataset.json",
        help="Path to evaluation dataset JSON file (default: evaluation/dataset.json)",
    )
    parser.add_argument(
        "--output-json",
        default="evaluation/results/baseline_results.json",
        help="Path to output machine-readable JSON results",
    )
    parser.add_argument(
        "--output-md",
        default="evaluation/results/baseline_report.md",
        help="Path to output human-readable Markdown report",
    )
    parser.add_argument(
        "--threshold",
        type=int,
        default=2,
        help="Binary relevance grade threshold (default: 2, meaning grades 2 and 3 are relevant)",
    )
    args = parser.parse_args()

    print(f"Loading evaluation dataset from: {args.dataset}")
    results = evaluate_dataset(dataset_path=args.dataset, relevance_threshold=args.threshold)

    # Ensure output directories exist
    os.makedirs(os.path.dirname(args.output_json), exist_ok=True)
    os.makedirs(os.path.dirname(args.output_md), exist_ok=True)

    with open(args.output_json, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"Machine-readable results saved to: {args.output_json}")

    report_md = generate_markdown_report(results)
    with open(args.output_md, "w", encoding="utf-8") as f:
        f.write(report_md)
    print(f"Human-readable report saved to: {args.output_md}")

    # Terminal summary
    print("\n" + "=" * 60)
    print("SCHOLYTICS BASELINE RETRIEVAL METRICS SUMMARY")
    print("=" * 60)
    meta = results["metadata"]
    metrics = results["macro_metrics"]
    lats = results["latencies"]["total"]
    print(f"Pipeline:           {meta['pipeline']}")
    print(f"Queries Evaluated:  {meta['total_queries']} (Failure rate: {meta['failure_rate'] * 100:.1f}%)")
    print(f"Precision@1:        {metrics['mean_precision@1']:.4f}")
    print(f"Precision@3:        {metrics['mean_precision@3']:.4f}")
    print(f"Recall@3:           {metrics['mean_recall@3']:.4f}")
    print(f"MRR:                {metrics['mean_reciprocal_rank']:.4f}")
    print(f"nDCG@3:             {metrics['mean_ndcg@3']:.4f}")
    print(f"nDCG@5:             {metrics['mean_ndcg@5']:.4f}")
    print(f"Mean Latency:       {lats['mean_ms']:.2f} ms (p50: {lats['p50_ms']:.2f} ms, p95: {lats['p95_ms']:.2f} ms)")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()

