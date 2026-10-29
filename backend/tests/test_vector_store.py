"""
Unit tests for the vector store abstraction layer and adapters.

Tests verify:
- Vector ID canonicalization policy (version stripping and deduplication).
- ChromaAdapter behavior (upsert, score mapping, query filtering, count, reset).
- PineconeAdapter behavior (upsert formatting, batching, metadata limits, score passthrough, direct host connection).
- Configuration validation and secret redaction.
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest

from db.chroma_adapter import ChromaAdapter
from db.vector_store import canonicalize_arxiv_id
from main import _build_vector_store


# ===========================================================================
# 1. Canonical arXiv ID Policy
# ===========================================================================

class TestCanonicalArxivId:
    def test_strips_version_suffix_standard(self):
        assert canonicalize_arxiv_id("2301.00001v1") == "2301.00001"
        assert canonicalize_arxiv_id("2301.00001v2") == "2301.00001"
        assert canonicalize_arxiv_id("2301.00001v12") == "2301.00001"

    def test_canonical_id_unchanged(self):
        assert canonicalize_arxiv_id("2301.00001") == "2301.00001"
        assert canonicalize_arxiv_id("1706.03762") == "1706.03762"

    def test_legacy_format_with_version(self):
        assert canonicalize_arxiv_id("cs/0101001v1") == "cs/0101001"
        assert canonicalize_arxiv_id("math/0211159v3") == "math/0211159"

    def test_strips_surrounding_whitespace(self):
        assert canonicalize_arxiv_id("  2301.00001v3  ") == "2301.00001"

    def test_empty_or_none(self):
        assert canonicalize_arxiv_id("") == ""
        assert canonicalize_arxiv_id(None) == ""


# ===========================================================================
# 2. ChromaAdapter
# ===========================================================================

class TestChromaAdapter:
    @pytest.fixture
    def adapter(self):
        return ChromaAdapter()

    def test_upsert_empty_papers(self, adapter):
        assert adapter.upsert_papers([], []) == 0

    def test_upsert_and_query_paper(self, adapter):
        papers = [
            {
                "arxiv_id": "2301.00010v1",
                "title": "Attention is All You Need",
                "abstract": "We propose the Transformer.",
                "authors": ["Ashish Vaswani", "Noam Shazeer"],
                "published": "2017-06-12",
                "categories": ["cs.CL", "cs.LG"],
                "pdf_url": "https://arxiv.org/pdf/2301.00010",
                "entry_url": "https://arxiv.org/abs/2301.00010",
            }
        ]
        embeddings = [[0.1] * 384]

        # Upsert paper
        count = adapter.upsert_papers(papers, embeddings)
        assert count == 1

        # Query using both canonical and versioned ID
        matches = adapter.query(
            query_vector=[0.1] * 384,
            n_results=5,
            filter_ids=["2301.00010v1"],
        )
        assert len(matches) == 1
        assert matches[0]["id"] == "2301.00010"  # canonical ID
        assert 0.0 <= matches[0]["score"] <= 1.0

    def test_query_empty_filter_ids(self, adapter):
        matches = adapter.query(
            query_vector=[0.1] * 384,
            n_results=5,
            filter_ids=[],
        )
        assert matches == []

    def test_count_and_reset(self, adapter):
        adapter.reset()
        initial_count = adapter.count()

        papers = [{"arxiv_id": "2301.00020", "title": "Test Paper", "abstract": "Test"}]
        embeddings = [[0.05] * 384]
        adapter.upsert_papers(papers, embeddings)

        assert adapter.count() >= initial_count + 1

        adapter.reset()
        assert adapter.count() == 0


# ===========================================================================
# 3. PineconeAdapter
# ===========================================================================

class TestPineconeAdapter:
    def test_missing_api_key_raises(self):
        with patch.dict(os.environ, {"PINECONE_API_KEY": ""}, clear=False):
            from db.pinecone_adapter import PineconeAdapter

            with pytest.raises(RuntimeError) as exc_info:
                PineconeAdapter()
            assert "PINECONE_API_KEY is not set" in str(exc_info.value)

    def test_missing_index_raises_when_no_auto_create(self):
        with patch.dict(os.environ, {"PINECONE_API_KEY": "dummy_key", "PINECONE_AUTO_CREATE_INDEX": "false"}):
            with patch("pinecone.Pinecone") as mock_pinecone_class:
                mock_client = MagicMock()
                mock_index_model = MagicMock()
                mock_index_model.name = "other-index"
                mock_client.list_indexes.return_value = [mock_index_model]
                mock_pinecone_class.return_value = mock_client

                from db.pinecone_adapter import PineconeAdapter

                with pytest.raises(RuntimeError) as exc_info:
                    PineconeAdapter()
                assert "does not exist" in str(exc_info.value)
                assert "dummy_key" not in str(exc_info.value)

    def test_connects_to_existing_index(self):
        with patch.dict(os.environ, {"PINECONE_API_KEY": "dummy_key", "PINECONE_INDEX_NAME": "my-index"}):
            with patch("pinecone.Pinecone") as mock_pinecone_class:
                mock_client = MagicMock()
                mock_index_model = MagicMock()
                mock_index_model.name = "my-index"
                mock_client.list_indexes.return_value = [mock_index_model]
                mock_pinecone_class.return_value = mock_client

                from db.pinecone_adapter import PineconeAdapter

                adapter = PineconeAdapter()
                assert adapter._index_name == "my-index"
                mock_client.Index.assert_called_once_with("my-index")

    def test_connects_with_direct_host(self):
        host = "https://scholytics-papers-test.pinecone.io"
        with patch.dict(os.environ, {"PINECONE_API_KEY": "dummy_key", "PINECONE_HOST": host}):
            with patch("pinecone.Pinecone") as mock_pinecone_class:
                mock_client = MagicMock()
                mock_pinecone_class.return_value = mock_client

                from db.pinecone_adapter import PineconeAdapter

                adapter = PineconeAdapter()
                mock_client.Index.assert_called_once_with("scholytics-papers", host=host)
                # list_indexes should not be called when direct host is provided
                mock_client.list_indexes.assert_not_called()

    def test_upsert_formats_canonical_id_and_truncates_abstract(self):
        with patch.dict(os.environ, {"PINECONE_API_KEY": "dummy_key"}):
            with patch("pinecone.Pinecone") as mock_pinecone_class:
                mock_client = MagicMock()
                mock_index_model = MagicMock()
                mock_index_model.name = "scholytics-papers"
                mock_client.list_indexes.return_value = [mock_index_model]
                mock_index = MagicMock()
                mock_index.upsert.return_value = MagicMock(upserted_count=1)
                mock_client.Index.return_value = mock_index
                mock_pinecone_class.return_value = mock_client

                from db.pinecone_adapter import PineconeAdapter

                adapter = PineconeAdapter()

                long_abstract = "A" * 3000
                papers = [
                    {
                        "arxiv_id": "2301.00045v3",
                        "title": "Quantum Attention",
                        "abstract": long_abstract,
                        "authors": ["Alice", "Bob"],
                        "published": "2023-01-01",
                        "categories": ["quant-ph", "cs.AI"],
                        "pdf_url": "https://arxiv.org/pdf/2301.00045",
                        "entry_url": "https://arxiv.org/abs/2301.00045",
                    }
                ]
                embeddings = [[0.2] * 384]

                upserted = adapter.upsert_papers(papers, embeddings)
                assert upserted == 1

                mock_index.upsert.assert_called_once()
                call_kwargs = mock_index.upsert.call_args.kwargs
                vectors = call_kwargs["vectors"]
                assert len(vectors) == 1
                vec = vectors[0]
                assert vec["id"] == "2301.00045"  # stripped version suffix
                assert len(vec["metadata"]["abstract"]) == 2000  # truncated
                assert vec["metadata"]["arxiv_id"] == "2301.00045"
                assert vec["metadata"]["authors"] == "Alice, Bob"

    def test_query_filter_ids_and_passthrough_score(self):
        with patch.dict(os.environ, {"PINECONE_API_KEY": "dummy_key"}):
            with patch("pinecone.Pinecone") as mock_pinecone_class:
                mock_client = MagicMock()
                mock_index_model = MagicMock()
                mock_index_model.name = "scholytics-papers"
                mock_client.list_indexes.return_value = [mock_index_model]
                mock_index = MagicMock()

                # Mock query response
                mock_match1 = MagicMock(id="2301.00001", score=0.88, metadata={"title": "Paper 1"})
                mock_match2 = MagicMock(id="2301.00002", score=0.95, metadata={"title": "Paper 2"})
                mock_index.query.return_value = MagicMock(matches=[mock_match1, mock_match2])

                mock_client.Index.return_value = mock_index
                mock_pinecone_class.return_value = mock_client

                from db.pinecone_adapter import PineconeAdapter

                adapter = PineconeAdapter()
                results = adapter.query(
                    query_vector=[0.1] * 384,
                    n_results=5,
                    filter_ids=["2301.00001v1", "2301.00002"],
                )

                mock_index.query.assert_called_once_with(
                    vector=[0.1] * 384,
                    top_k=2,
                    filter={"arxiv_id": {"$in": ["2301.00001", "2301.00002"]}},
                    include_metadata=True,
                    include_values=False,
                )

                # Results sorted descending by similarity score
                assert len(results) == 2
                assert results[0]["id"] == "2301.00002"
                assert results[0]["score"] == 0.95
                assert results[1]["id"] == "2301.00001"
                assert results[1]["score"] == 0.88

    def test_count_and_reset(self):
        with patch.dict(os.environ, {"PINECONE_API_KEY": "dummy_key"}):
            with patch("pinecone.Pinecone") as mock_pinecone_class:
                mock_client = MagicMock()
                mock_index_model = MagicMock()
                mock_index_model.name = "scholytics-papers"
                mock_client.list_indexes.return_value = [mock_index_model]
                mock_index = MagicMock()
                mock_index.describe_index_stats.return_value = MagicMock(total_vector_count=42)
                mock_client.Index.return_value = mock_index
                mock_pinecone_class.return_value = mock_client

                from db.pinecone_adapter import PineconeAdapter

                adapter = PineconeAdapter()
                assert adapter.count() == 42
                mock_index.describe_index_stats.assert_called_once()

                adapter.reset()
                mock_index.delete.assert_called_once_with(delete_all=True)


# ===========================================================================
# 4. Vector Store Factory in main.py
# ===========================================================================

class TestVectorStoreFactory:
    def test_default_is_chroma(self):
        with patch.dict(os.environ, {"VECTOR_STORE_BACKEND": ""}, clear=False):
            store = _build_vector_store()
            assert isinstance(store, ChromaAdapter)

    def test_explicit_chroma_backend(self):
        with patch.dict(os.environ, {"VECTOR_STORE_BACKEND": "chroma"}):
            store = _build_vector_store()
            assert isinstance(store, ChromaAdapter)

    def test_explicit_pinecone_backend(self):
        with patch.dict(os.environ, {"VECTOR_STORE_BACKEND": "pinecone", "PINECONE_API_KEY": "dummy"}):
            with patch("pinecone.Pinecone") as mock_pc:
                mock_client = MagicMock()
                mock_index_model = MagicMock()
                mock_index_model.name = "scholytics-papers"
                mock_client.list_indexes.return_value = [mock_index_model]
                mock_pc.return_value = mock_client

                from db.pinecone_adapter import PineconeAdapter
                store = _build_vector_store()
                assert isinstance(store, PineconeAdapter)

    def test_unknown_backend_raises(self):
        with patch.dict(os.environ, {"VECTOR_STORE_BACKEND": "milvus"}):
            with pytest.raises(RuntimeError) as exc_info:
                _build_vector_store()
            assert "Unknown VECTOR_STORE_BACKEND='milvus'" in str(exc_info.value)

    def test_production_chroma_guard_raises(self):
        with patch.dict(os.environ, {"ENVIRONMENT": "production", "VECTOR_STORE_BACKEND": "chroma"}, clear=False):
            with pytest.raises(RuntimeError) as exc_info:
                _build_vector_store()
            assert "Production environment detected" in str(exc_info.value)
            assert "VECTOR_STORE_BACKEND is set to ephemeral 'chroma'" in str(exc_info.value)

    def test_production_chroma_bypass_allowed(self):
        with patch.dict(
            os.environ,
            {
                "ENVIRONMENT": "production",
                "VECTOR_STORE_BACKEND": "chroma",
                "ALLOW_EPHEMERAL_CHROMA_IN_PRODUCTION": "true",
            },
            clear=False,
        ):
            store = _build_vector_store()
            assert isinstance(store, ChromaAdapter)

    def test_cors_comma_separated_origins(self):
        from main import get_allowed_origins

        with patch.dict(
            os.environ,
            {"FRONTEND_ORIGIN": "https://scholytics.vercel.app, http://localhost:3000/"},
        ):
            origins = get_allowed_origins()
            assert "https://scholytics.vercel.app" in origins
            assert "http://localhost:3000" in origins

    def test_pinecone_invalid_dimension_raises(self):
        with patch.dict(os.environ, {"PINECONE_API_KEY": "dummy_key", "PINECONE_INDEX_NAME": "scholytics-papers"}):
            with patch("pinecone.Pinecone") as mock_pinecone_class:
                mock_client = MagicMock()
                mock_index_model = MagicMock()
                mock_index_model.name = "scholytics-papers"
                mock_index_model.dimension = 1536  # Invalid dimension
                mock_index_model.metric = "cosine"
                mock_client.list_indexes.return_value = [mock_index_model]
                mock_pinecone_class.return_value = mock_client

                from db.pinecone_adapter import PineconeAdapter

                with pytest.raises(RuntimeError) as exc_info:
                    PineconeAdapter()
                assert "has dimension=1536" in str(exc_info.value)

    def test_pinecone_invalid_metric_raises(self):
        with patch.dict(os.environ, {"PINECONE_API_KEY": "dummy_key", "PINECONE_INDEX_NAME": "scholytics-papers"}):
            with patch("pinecone.Pinecone") as mock_pinecone_class:
                mock_client = MagicMock()
                mock_index_model = MagicMock()
                mock_index_model.name = "scholytics-papers"
                mock_index_model.dimension = 384
                mock_index_model.metric = "euclidean"  # Invalid metric
                mock_client.list_indexes.return_value = [mock_index_model]
                mock_pinecone_class.return_value = mock_client

                from db.pinecone_adapter import PineconeAdapter

                with pytest.raises(RuntimeError) as exc_info:
                    PineconeAdapter()
                assert "has metric='euclidean'" in str(exc_info.value)
