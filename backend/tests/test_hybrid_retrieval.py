"""
Unit tests for BM25 keyword retrieval, Reciprocal Rank Fusion, and Hybrid Search.

Covers:
1. BM25 tokenization, stemming, stopword removal, and scoring.
2. Inverted index update, removal, and capacity eviction.
3. Reciprocal Rank Fusion (RRF) math, score normalization, and canonical deduplication.
4. Partial failure resilience (dense failure fallback, keyword failure fallback).
5. Search route integration with hybrid ranking.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from db.vector_store import canonicalize_arxiv_id
from main import app
from services.bm25 import BM25Index, _stem, tokenize
from services.fusion import reciprocal_rank_fusion


# ===========================================================================
# 1. BM25 Tokenization and Stemming Tests
# ===========================================================================

class TestBM25Tokenizer:
    def test_tokenize_lowercases_and_strips_punctuation(self):
        tokens = tokenize("Transformer: Attention-based Architecture!")
        assert "transformer" in tokens or "transform" in tokens
        assert "attention" in tokens or "attent" in tokens
        assert "architecture" in tokens

    def test_tokenize_filters_stopwords(self):
        tokens = tokenize("this is a paper about the deep learning")
        assert "this" not in tokens
        assert "is" not in tokens
        assert "a" not in tokens
        assert "about" not in tokens
        assert "the" not in tokens
        assert "deep" in tokens
        assert "learn" in tokens  # stemmed

    def test_stemming_rules(self):
        assert _stem("transformers") == "transformer"
        assert _stem("modeling") == "model"
        assert _stem("trained") == "train"
        assert _stem("attention") == "attent"
        assert _stem("categories") == "category"
        assert _stem("ai") == "ai"  # short tokens preserved


# ===========================================================================
# 2. BM25 Inverted Index & Scoring Tests
# ===========================================================================

class TestBM25Index:
    def test_add_and_search_exact_match(self):
        index = BM25Index()
        index.add_document("doc1", "Low-Rank Adaptation LoRA of Large Language Models")
        index.add_document("doc2", "Convolutional Neural Networks for Computer Vision")
        index.add_document("doc3", "Direct Preference Optimization DPO Alignment")

        results = index.search("LoRA adaptation", top_k=2)
        assert len(results) == 1
        assert results[0]["id"] == "doc1"
        assert results[0]["score"] > 0.0

    def test_update_document_replaces_postings(self):
        index = BM25Index()
        index.add_document("doc1", "Quantum Computing")
        assert len(index.search("quantum")) == 1

        # Overwrite with new text
        index.add_document("doc1", "Classical Thermodynamics")
        assert len(index.search("quantum")) == 0
        assert len(index.search("thermodynamics")) == 1

    def test_remove_document(self):
        index = BM25Index()
        index.add_document("doc1", "Transformers Attention")
        assert index.total_documents == 1
        index.remove_document("doc1")
        assert index.total_documents == 0
        assert len(index.search("transformers")) == 0

    def test_capacity_eviction_bounded_memory(self):
        # Index with small max_documents=2
        index = BM25Index(max_documents=2)
        index.add_document("doc1", "First Paper")
        index.add_document("doc2", "Second Paper")
        assert index.total_documents == 2

        # Adding a 3rd document should evict the oldest ("doc1")
        index.add_document("doc3", "Third Paper")
        assert index.total_documents == 2
        assert len(index.search("First")) == 0
        assert len(index.search("Third")) == 1

    def test_filter_ids_constraint(self):
        index = BM25Index()
        index.add_document("doc1", "Deep Learning Architectures")
        index.add_document("doc2", "Deep Learning Optimizers")

        # Query matches both, but filter_ids constrains to doc2
        results = index.search("Deep Learning", filter_ids=["doc2"])
        assert len(results) == 1
        assert results[0]["id"] == "doc2"

    def test_memory_usage_reporting(self):
        index = BM25Index()
        index.add_document("doc1", "Test content")
        mem_bytes = index.memory_usage_bytes()
        assert mem_bytes > 0


# ===========================================================================
# 3. Reciprocal Rank Fusion (RRF) Tests
# ===========================================================================

class TestRankingFusion:
    def test_rrf_scoring_and_ranking(self):
        # Doc A is rank 1 in dense, rank 2 in keyword
        # Doc B is rank 2 in dense, rank 1 in keyword
        # Doc C is rank 3 in dense, missing in keyword
        dense = [
            {"id": "docA", "score": 0.95},
            {"id": "docB", "score": 0.85},
            {"id": "docC", "score": 0.70},
        ]
        keyword = [
            {"id": "docB", "score": 8.5},
            {"id": "docA", "score": 6.2},
        ]

        fused = reciprocal_rank_fusion(dense, keyword, k=60.0, weight_dense=1.0, weight_keyword=1.0)
        assert len(fused) == 3

        # Doc A score: 1/(60+1) + 1/(60+2) = 1/61 + 1/62
        # Doc B score: 1/(60+2) + 1/(60+1) = 1/62 + 1/61 (tie)
        # Doc C score: 1/(60+3) = 1/63 (lower)
        top_ids = {fused[0]["id"], fused[1]["id"]}
        assert top_ids == {"docA", "docB"}
        assert fused[2]["id"] == "docC"
        assert fused[0]["score"] > fused[2]["score"]

    def test_rrf_deduplicates_canonical_ids(self):
        # Versioned IDs should be deduplicated to canonical IDs
        dense = [{"id": "2301.00001v1", "score": 0.9}]
        keyword = [{"id": "2301.00001v2", "score": 5.0}]

        fused = reciprocal_rank_fusion(dense, keyword)
        assert len(fused) == 1
        assert fused[0]["id"] == "2301.00001"
        assert fused[0]["dense_rank"] == 1
        assert fused[0]["keyword_rank"] == 1

    def test_rrf_partial_failure_dense_only(self):
        dense = [{"id": "doc1", "score": 0.85}, {"id": "doc2", "score": 0.60}]
        keyword = []  # keyword search produced no matches

        fused = reciprocal_rank_fusion(dense, keyword)
        assert len(fused) == 2
        assert fused[0]["id"] == "doc1"
        assert fused[0]["score"] > fused[1]["score"]

    def test_rrf_partial_failure_keyword_only(self):
        dense = []  # dense search unavailable or timed out
        keyword = [{"id": "doc1", "score": 10.0}, {"id": "doc2", "score": 5.0}]

        fused = reciprocal_rank_fusion(dense, keyword)
        assert len(fused) == 2
        assert fused[0]["id"] == "doc1"
        assert fused[0]["score"] > fused[1]["score"]

    def test_rrf_both_empty_returns_empty(self):
        assert reciprocal_rank_fusion([], []) == []


# ===========================================================================
# 4. Search Endpoint Hybrid Integration Tests
# ===========================================================================

class TestSearchHybridIntegration:
    @patch("services.arxiv_client.search_papers")
    @patch("services.embedder.embed_query")
    @patch("services.embedder.embed_texts")
    def test_search_endpoint_returns_hybrid_mode(
        self,
        mock_embed_texts,
        mock_embed_query,
        mock_search,
    ):
        mock_embed_query.return_value = [0.1] * 384
        mock_embed_texts.return_value = [[0.1] * 384, [0.2] * 384]

        p1 = {
            "arxiv_id": "2301.00010v1",
            "title": "Low-Rank Adaptation LoRA",
            "abstract": "Parameter-efficient fine-tuning for LLMs using LoRA.",
            "authors": ["Edward Hu"],
            "published": "2021-06-17",
            "categories": ["cs.CL"],
            "pdf_url": "https://arxiv.org/pdf/2301.00010",
            "entry_url": "https://arxiv.org/abs/2301.00010",
        }
        p2 = {
            "arxiv_id": "2301.00020v1",
            "title": "Dense Passage Retrieval",
            "abstract": "Dual-encoder architecture for open-domain QA.",
            "authors": ["Vladimir Karpukhin"],
            "published": "2020-04-10",
            "categories": ["cs.CL"],
            "pdf_url": "https://arxiv.org/pdf/2301.00020",
            "entry_url": "https://arxiv.org/abs/2301.00020",
        }
        mock_search.return_value = [p1, p2]

        with TestClient(app) as client:
            # Query containing exact keyword 'LoRA'
            resp = client.post("/api/search", json={"query": "LoRA fine-tuning"})
            assert resp.status_code == 200
            data = resp.json()
            assert data["total"] == 2
            assert data["retrieval_mode"] == "hybrid"
            # p1 matches both LoRA keyword and query embedding -> ranked top
            assert canonicalize_arxiv_id(data["results"][0]["arxiv_id"]) == "2301.00010"
            assert 0.0 <= data["results"][0]["relevance_score"] <= 1.0
