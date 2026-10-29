"""
Tests for the evaluation dataset, IR metrics, and benchmark pipeline.
"""
from __future__ import annotations

import json
import os
import sys


# Ensure repository root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from evaluation import metrics
from evaluation.benchmark import evaluate_dataset, generate_markdown_report, percentile


# ===========================================================================
# 1. Metric Unit Tests
# ===========================================================================

class TestIRMetrics:
    def test_precision_at_k_perfect(self):
        gt = {"d1": 3, "d2": 2, "d3": 0}
        retrieved = ["d1", "d2", "d3"]
        assert metrics.precision_at_k(retrieved, gt, k=2, relevance_threshold=2) == 1.0

    def test_precision_at_k_partial(self):
        gt = {"d1": 3, "d2": 0, "d3": 2}
        retrieved = ["d1", "d2", "d3"]
        # In top 2: d1 is relevant, d2 is not -> 1/2 = 0.5
        assert metrics.precision_at_k(retrieved, gt, k=2, relevance_threshold=2) == 0.5

    def test_precision_at_k_zero_k_or_empty(self):
        assert metrics.precision_at_k([], {"d1": 3}, k=5) == 0.0
        assert metrics.precision_at_k(["d1"], {"d1": 3}, k=0) == 0.0

    def test_recall_at_k_perfect(self):
        gt = {"d1": 3, "d2": 2, "d3": 0}
        retrieved = ["d1", "d2", "d3"]
        # Total relevant = 2. Top 2 retrieved contains both -> 2/2 = 1.0
        assert metrics.recall_at_k(retrieved, gt, k=2, relevance_threshold=2) == 1.0

    def test_recall_at_k_partial(self):
        gt = {"d1": 3, "d2": 2, "d3": 2, "d4": 0}
        retrieved = ["d1", "d4", "d2"]
        # Total relevant = 3 (d1, d2, d3). Top 2 has d1 -> 1/3
        assert abs(metrics.recall_at_k(retrieved, gt, k=2, relevance_threshold=2) - (1.0 / 3.0)) < 1e-6

    def test_recall_at_k_no_relevant_docs(self):
        gt = {"d1": 0, "d2": 1}
        # Zero relevant documents in candidate pool
        assert metrics.recall_at_k(["d1"], gt, k=1, relevance_threshold=2) == 0.0

    def test_reciprocal_rank_first_hit(self):
        gt = {"d1": 3, "d2": 0}
        assert metrics.reciprocal_rank(["d1", "d2"], gt, relevance_threshold=2) == 1.0

    def test_reciprocal_rank_second_hit(self):
        gt = {"d1": 0, "d2": 2, "d3": 3}
        assert metrics.reciprocal_rank(["d1", "d2", "d3"], gt, relevance_threshold=2) == 0.5

    def test_reciprocal_rank_no_hit(self):
        gt = {"d1": 0, "d2": 1}
        assert metrics.reciprocal_rank(["d1", "d2"], gt, relevance_threshold=2) == 0.0

    def test_ndcg_at_k_perfect(self):
        # Ideal order: highest relevance first
        gt = {"d1": 3, "d2": 2, "d3": 1, "d4": 0}
        retrieved = ["d1", "d2", "d3", "d4"]
        assert abs(metrics.ndcg_at_k(retrieved, gt, k=3) - 1.0) < 1e-6

    def test_ndcg_at_k_suboptimal(self):
        gt = {"d1": 3, "d2": 2, "d3": 0}
        # Inverted order: d2 (rel 2), d1 (rel 3)
        retrieved = ["d2", "d1", "d3"]
        ndcg = metrics.ndcg_at_k(retrieved, gt, k=2)
        assert 0.0 < ndcg < 1.0
        # Calculate manually:
        # DCG@2 = (2^2 - 1)/log2(2) + (2^3 - 1)/log2(3) = 3/1 + 7/1.58496 = 3 + 4.4165 = 7.4165
        # IDCG@2 = (2^3 - 1)/log2(2) + (2^2 - 1)/log2(3) = 7/1 + 3/1.58496 = 7 + 1.8928 = 8.8928
        # nDCG = 7.4165 / 8.8928 = 0.8340
        assert abs(ndcg - (7.4165 / 8.8928)) < 0.01

    def test_ndcg_at_k_all_zero(self):
        gt = {"d1": 0, "d2": 0}
        assert metrics.ndcg_at_k(["d1", "d2"], gt, k=2) == 0.0

    def test_percentile_calculation(self):
        data = [10.0, 20.0, 30.0, 40.0, 50.0]
        assert percentile(data, 50.0) == 30.0
        assert percentile(data, 0.0) == 10.0
        assert percentile(data, 100.0) == 50.0


# ===========================================================================
# 2. Dataset Schema & Integrity Validation
# ===========================================================================

class TestEvaluationDatasetIntegrity:
    DATASET_PATH = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "evaluation", "dataset.json")
    )

    def test_dataset_exists_and_parses(self):
        assert os.path.exists(self.DATASET_PATH), f"Dataset missing at {self.DATASET_PATH}"
        with open(self.DATASET_PATH, encoding="utf-8") as f:
            data = json.load(f)
        assert "metadata" in data
        assert "queries" in data
        assert len(data["queries"]) >= 5

    def test_dataset_query_structure(self):
        with open(self.DATASET_PATH, encoding="utf-8") as f:
            data = json.load(f)

        query_ids = set()
        for q in data["queries"]:
            qid = q.get("query_id")
            assert qid, "query_id must not be empty"
            assert qid not in query_ids, f"Duplicate query_id: {qid}"
            query_ids.add(qid)

            assert q.get("query"), f"Query text missing in {qid}"
            assert q.get("domain"), f"Domain missing in {qid}"

            candidates = q.get("candidate_pool", [])
            ground_truth = q.get("ground_truth", [])

            assert len(candidates) >= 5, f"Candidate pool too small for {qid}"
            assert len(ground_truth) == len(candidates), f"Mismatch in {qid}"

            candidate_ids = {c["arxiv_id"] for c in candidates}
            for gt in ground_truth:
                assert gt["arxiv_id"] in candidate_ids, f"Unknown paper {gt['arxiv_id']} in ground truth of {qid}"
                assert gt["relevance"] in {0, 1, 2, 3}, f"Invalid grade {gt['relevance']} in {qid}"
                assert gt["label_type"] in {"manual_verified", "metadata_heuristic"}
                assert gt.get("notes"), f"Notes required for label justification in {qid}"


# ===========================================================================
# 3. Benchmark Pipeline Execution
# ===========================================================================

class TestBenchmarkPipelineExecution:
    def test_evaluate_dataset_runs_and_produces_valid_structure(self, tmp_path):
        # Create a mini dataset
        mini_dataset = {
            "metadata": {"name": "Test Dataset", "total_queries": 1},
            "queries": [
                {
                    "query_id": "test_q1",
                    "query": "transformer attention mechanisms",
                    "domain": "NLP",
                    "candidate_pool": [
                        {
                            "arxiv_id": "2301.00001",
                            "title": "Attention Is All You Need",
                            "abstract": "We propose the Transformer model based solely on attention mechanisms.",
                            "published": "2023-01-01",
                        },
                        {
                            "arxiv_id": "2301.00002",
                            "title": "Convolutional Networks for Images",
                            "abstract": "Standard convolutional layers without self-attention.",
                            "published": "2023-01-01",
                        },
                    ],
                    "ground_truth": [
                        {"arxiv_id": "2301.00001", "relevance": 3, "label_type": "manual_verified", "notes": "Core"},
                        {"arxiv_id": "2301.00002", "relevance": 0, "label_type": "manual_verified", "notes": "Negative"},
                    ],
                }
            ],
        }
        dataset_file = tmp_path / "mini_dataset.json"
        dataset_file.write_text(json.dumps(mini_dataset), encoding="utf-8")

        results = evaluate_dataset(str(dataset_file), relevance_threshold=2)

        assert "metadata" in results
        assert results["metadata"]["successful_queries"] == 1
        assert results["metadata"]["failed_queries"] == 0

        assert "macro_metrics" in results
        macro = results["macro_metrics"]
        assert "mean_precision@1" in macro
        assert "mean_reciprocal_rank" in macro
        assert "mean_ndcg@3" in macro

        assert "latencies" in results
        assert "total" in results["latencies"]

        # Verify Markdown generation
        md_report = generate_markdown_report(results)
        assert "# Scholytics Baseline Retrieval Evaluation Report" in md_report
        assert "Precision@1" in md_report

