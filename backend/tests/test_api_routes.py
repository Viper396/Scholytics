"""
Integration and route tests for Scholytics FastAPI endpoints.

External services (arXiv API and Groq LLM) are mocked so tests run without
network access or live API keys. Tests exercise full FastAPI request/response contracts.
"""
from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# Ensure backend directory is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import app


@pytest.fixture
def client():
    """Provides a TestClient with lifespan context manager for collection initialization."""
    with TestClient(app) as test_client:
        yield test_client


# Sample paper fixture
def _make_sample_paper(arxiv_id: str, title: str = "Test Paper", authors: list[str] | None = None, categories: list[str] | None = None):
    return {
        "arxiv_id": arxiv_id,
        "title": title,
        "authors": authors or ["Alice Smith", "Bob Jones"],
        "abstract": f"Abstract for {title}",
        "published": "2023-01-15",
        "categories": categories or ["cs.AI"],
        "pdf_url": f"https://arxiv.org/pdf/{arxiv_id}",
        "entry_url": f"https://arxiv.org/abs/{arxiv_id}",
    }


# ===========================================================================
# 1. Health & Secret Redaction Tests
# ===========================================================================

class TestHealthAndSecurity:
    def test_health_liveness(self, client):
        response = client.get("/")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    def test_readiness_redacts_groq_key(self, client):
        """Readiness check must report boolean status without leaking key."""
        with patch.dict(os.environ, {"GROQ_API_KEY": "gsk_super_secret_key_12345"}):
            response = client.get("/health/ready")
            assert response.status_code == 200
            data = response.json()
            assert data["groq_configured"] is True
            assert "gsk_super_secret_key_12345" not in response.text

    def test_readiness_reports_degraded_when_key_missing(self, client):
        with patch.dict(os.environ, {"GROQ_API_KEY": ""}):
            response = client.get("/health/ready")
            assert response.status_code == 200
            data = response.json()
            assert data["groq_configured"] is False
            assert "GROQ_API_KEY is not configured" in data["issues"]


# ===========================================================================
# 2. Search Request Validation & Filter Boundaries
# ===========================================================================

class TestSearchValidationAndFilters:
    def test_search_query_empty_fails(self, client):
        response = client.post("/api/search", json={"query": ""})
        assert response.status_code == 422

    def test_search_query_overlong_fails(self, client):
        response = client.post("/api/search", json={"query": "a" * 401})
        assert response.status_code == 422

    def test_search_max_results_boundaries(self, client):
        # 0 is below minimum 1
        assert client.post("/api/search", json={"query": "test", "max_results": 0}).status_code == 422
        # 26 is above maximum 25
        assert client.post("/api/search", json={"query": "test", "max_results": 26}).status_code == 422

    def test_search_invalid_category_fails(self, client):
        response = client.post("/api/search", json={
            "query": "test",
            "filters": {"categories": ["unsupported.category"]}
        })
        assert response.status_code == 422
        assert "Unsupported categories" in response.text

    def test_search_invalid_date_format_fails(self, client):
        response = client.post("/api/search", json={
            "query": "test",
            "filters": {"date_from": "2023/01/01"}
        })
        assert response.status_code == 422
        assert "YYYY-MM-DD" in response.text

    def test_search_future_date_fails(self, client):
        response = client.post("/api/search", json={
            "query": "test",
            "filters": {"date_from": "2099-01-01"}
        })
        assert response.status_code == 422
        assert "future" in response.text.lower()


# ===========================================================================
# 3. Search Workflow: Empty Results, Upstream Failures, & Degradation
# ===========================================================================

class TestSearchWorkflowAndDegradation:
    @patch("services.arxiv_client.search_papers")
    def test_search_empty_results(self, mock_search, client):
        mock_search.return_value = []
        response = client.post("/api/search", json={"query": "unknown topic"})
        assert response.status_code == 200
        data = response.json()
        assert data["results"] == []
        assert data["total"] == 0

    @patch("services.arxiv_client.search_papers")
    def test_search_upstream_failure_returns_503(self, mock_search, client):
        mock_search.side_effect = RuntimeError("arXiv search failed")
        response = client.post("/api/search", json={"query": "machine learning"})
        assert response.status_code == 503
        assert "arXiv search is currently unavailable" in response.json()["detail"]

    @patch("services.arxiv_client.search_papers")
    def test_search_unexpected_error_returns_500_without_stacktrace(self, mock_search, client):
        mock_search.side_effect = Exception("Internal DB failure secret_db_pw")
        response = client.post("/api/search", json={"query": "machine learning"})
        assert response.status_code == 500
        assert response.json()["detail"] == "Search pipeline failed"
        assert "secret_db_pw" not in response.text

    @patch("services.arxiv_client.search_papers")
    @patch("services.embedder.index_papers")
    def test_search_embedding_failure_returns_unranked_results(self, mock_index, mock_search, client):
        """When FastEmbed is unavailable, return unranked results with warning."""
        mock_search.return_value = [_make_sample_paper("2301.00001")]
        mock_index.side_effect = RuntimeError("Embedding model is unavailable")

        response = client.post("/api/search", json={"query": "machine learning"})
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        result = data["results"][0]
        assert result["arxiv_id"] == "2301.00001"
        assert result["relevance_score"] is None
        assert result["ranking_degraded"] is True
        assert "ranking_note" in data


# ===========================================================================
# 4. Relevance Ordering and Score Calculation
# ===========================================================================

class TestSearchRanking:
    @patch("services.arxiv_client.search_papers")
    @patch("services.embedder.index_papers")
    @patch("services.embedder.embed_query")
    @patch("services.embedder.is_using_hash_fallback")
    def test_correct_relevance_ordering(self, mock_fallback, mock_query_emb, mock_index, mock_search, client):
        mock_fallback.return_value = False
        p1 = _make_sample_paper("2301.00001", title="Paper 1")
        p2 = _make_sample_paper("2301.00002", title="Paper 2")
        mock_search.return_value = [p1, p2]
        mock_query_emb.return_value = [0.1] * 384

        # Mock collection query returning distances
        # ChromaDB cosine distance: 0.1 -> score 0.90; distance 0.6 -> score 0.40
        fake_collection = MagicMock()
        fake_collection.query.return_value = {
            "ids": [["2301.00002", "2301.00001"]],
            "distances": [[0.6, 0.1]],  # p1 is more relevant than p2
            "metadatas": [[{}, {}]],
            "documents": [["", ""]],
        }

        with patch("routers.search.get_collection", return_value=fake_collection):
            response = client.post("/api/search", json={"query": "test query"})
            assert response.status_code == 200
            results = response.json()["results"]
            assert len(results) == 2
            # Should be ordered descending by relevance_score
            assert results[0]["arxiv_id"] == "2301.00001"
            assert abs(results[0]["relevance_score"] - 0.9) < 1e-4
            assert results[1]["arxiv_id"] == "2301.00002"
            assert abs(results[1]["relevance_score"] - 0.4) < 1e-4


# ===========================================================================
# 5. Paper Details & Summary Endpoints
# ===========================================================================

class TestPaperDetailsAndSummaries:
    @patch("services.arxiv_client.fetch_paper_by_id")
    def test_get_paper_success(self, mock_fetch, client):
        mock_fetch.return_value = _make_sample_paper("2301.00001")
        response = client.get("/api/papers/2301.00001")
        assert response.status_code == 200
        assert response.json()["arxiv_id"] == "2301.00001"

    @patch("services.arxiv_client.fetch_paper_by_id")
    def test_get_paper_not_found(self, mock_fetch, client):
        mock_fetch.return_value = None
        response = client.get("/api/papers/2301.99999")
        assert response.status_code == 404
        assert response.json()["detail"] == "Paper not found"

    def test_get_paper_malformed_id(self, client):
        response = client.get("/api/papers/invalid_id_format")
        assert response.status_code == 422

    @patch("services.arxiv_client.fetch_paper_by_id")
    @patch("services.summarizer.summarize_paper")
    def test_summarize_paper_success(self, mock_summarize, mock_fetch, client):
        mock_fetch.return_value = _make_sample_paper("2301.00001")
        mock_summarize.return_value = "This paper introduces a novel architecture."

        response = client.post("/api/papers/2301.00001/summarize")
        assert response.status_code == 200
        data = response.json()
        assert data["arxiv_id"] == "2301.00001"
        assert data["summary"] == "This paper introduces a novel architecture."

    @patch("services.arxiv_client.fetch_paper_by_id")
    @patch("services.summarizer.summarize_paper")
    def test_summarize_paper_failure_returns_500(self, mock_summarize, mock_fetch, client):
        mock_fetch.return_value = _make_sample_paper("2301.00001")
        mock_summarize.side_effect = RuntimeError("Groq API rate limit")

        response = client.post("/api/papers/2301.00001/summarize")
        assert response.status_code == 500
        assert response.json()["detail"] == "Failed to summarize paper"

    @patch("services.arxiv_client.fetch_paper_by_id")
    @patch("services.summarizer.summarize_multiple")
    def test_summarize_batch_success(self, mock_multi, mock_fetch, client):
        mock_fetch.return_value = _make_sample_paper("2301.00001")
        mock_multi.return_value = [{"arxiv_id": "2301.00001", "title": "Paper 1", "summary": "Summary 1"}]

        response = client.post("/api/papers/summarize-batch", json={"arxiv_ids": ["2301.00001"]})
        assert response.status_code == 200
        assert len(response.json()["papers"]) == 1
        assert response.json()["papers"][0]["summary"] == "Summary 1"


# ===========================================================================
# 6. Streaming Synthesis Endpoint
# ===========================================================================

class TestSynthesisStreaming:
    @patch("services.summarizer.generate_search_summary")
    def test_synthesize_streaming_with_metadata(self, mock_gen, client):
        """Synthesis should reuse pre-fetched paper metadata without querying arXiv."""
        mock_gen.return_value = iter(["Here is ", "the research ", "synthesis."])
        sample_paper = _make_sample_paper("2301.00001")

        response = client.post("/api/search/synthesize", json={
            "query": "transformer attention",
            "arxiv_ids": ["2301.00001"],
            "papers": [sample_paper],
        })

        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]
        body = response.text
        assert "data: Here is" in body
        assert "data: the research" in body
        assert "event: done" in body
        assert "data: [DONE]" in body

    @patch("services.summarizer.generate_search_summary")
    def test_synthesize_streaming_error_emits_error_event(self, mock_gen, client):
        """When Groq fails during stream, emit event: error rather than HTTP 500."""
        def error_generator(*args, **kwargs):
            yield "Starting..."
            raise RuntimeError("Groq connection lost")

        mock_gen.side_effect = error_generator
        sample_paper = _make_sample_paper("2301.00001")

        response = client.post("/api/search/synthesize", json={
            "query": "transformer attention",
            "arxiv_ids": ["2301.00001"],
            "papers": [sample_paper],
        })

        assert response.status_code == 200
        body = response.text
        assert "event: error" in body
        assert "data: Synthesis unavailable." in body

    @patch("services.arxiv_client.fetch_paper_by_id")
    def test_synthesize_no_papers_found_returns_404(self, mock_fetch, client):
        mock_fetch.return_value = None
        response = client.post("/api/search/synthesize", json={
            "query": "test",
            "arxiv_ids": ["2301.99999"],
        })
        assert response.status_code == 404


# ===========================================================================
# 7. Graph Generation Endpoint & Edge Construction
# ===========================================================================

class TestGraphEndpoint:
    def test_graph_empty_ids_fails(self, client):
        response = client.post("/api/graph", json={"arxiv_ids": []})
        assert response.status_code == 422

    def test_graph_malformed_id_fails(self, client):
        response = client.post("/api/graph", json={"arxiv_ids": ["bad_id"]})
        assert response.status_code == 422

    @patch("services.arxiv_client.fetch_paper_by_id")
    def test_graph_single_node_no_edges(self, mock_fetch, client):
        mock_fetch.return_value = _make_sample_paper("2301.00001")
        response = client.post("/api/graph", json={"arxiv_ids": ["2301.00001"]})
        assert response.status_code == 200
        data = response.json()
        assert len(data["nodes"]) == 1
        assert len(data["edges"]) == 0

    @patch("services.arxiv_client.fetch_paper_by_id")
    def test_graph_co_author_edge_construction(self, mock_fetch, client):
        # Two papers sharing author Alice
        p1 = _make_sample_paper("2301.00001", authors=["Alice", "Bob"], categories=["cs.AI"])
        p2 = _make_sample_paper("2301.00002", authors=["Alice", "Charlie"], categories=["cs.CV"])

        def fetch_mock(aid):
            return p1 if aid == "2301.00001" else p2

        mock_fetch.side_effect = fetch_mock

        response = client.post("/api/graph", json={"arxiv_ids": ["2301.00001", "2301.00002"]})
        assert response.status_code == 200
        data = response.json()
        assert len(data["nodes"]) == 2
        assert len(data["edges"]) == 1
        edge = data["edges"][0]
        assert edge["type"] == "co-author"
        assert edge["weight"] == 1

    @patch("services.arxiv_client.fetch_paper_by_id")
    def test_graph_same_field_edge_construction(self, mock_fetch, client):
        # Two papers with no shared authors, but shared category cs.AI
        p1 = _make_sample_paper("2301.00001", authors=["Alice"], categories=["cs.AI"])
        p2 = _make_sample_paper("2301.00002", authors=["Bob"], categories=["cs.AI", "cs.LG"])

        def fetch_mock(aid):
            return p1 if aid == "2301.00001" else p2

        mock_fetch.side_effect = fetch_mock

        response = client.post("/api/graph", json={"arxiv_ids": ["2301.00001", "2301.00002"]})
        assert response.status_code == 200
        data = response.json()
        assert len(data["nodes"]) == 2
        assert len(data["edges"]) == 1
        edge = data["edges"][0]
        assert edge["type"] == "same-field"
        assert edge["weight"] == 1

    @patch("services.arxiv_client.fetch_paper_by_id")
    def test_graph_no_shared_attributes_no_edge(self, mock_fetch, client):
        p1 = _make_sample_paper("2301.00001", authors=["Alice"], categories=["cs.AI"])
        p2 = _make_sample_paper("2301.00002", authors=["Bob"], categories=["cs.CV"])

        def fetch_mock(aid):
            return p1 if aid == "2301.00001" else p2

        mock_fetch.side_effect = fetch_mock

        response = client.post("/api/graph", json={"arxiv_ids": ["2301.00001", "2301.00002"]})
        assert response.status_code == 200
        data = response.json()
        assert len(data["nodes"]) == 2
        assert len(data["edges"]) == 0

    @patch("services.arxiv_client.fetch_paper_by_id")
    def test_graph_deduplicates_requested_ids(self, mock_fetch, client):
        mock_fetch.return_value = _make_sample_paper("2301.00001")
        response = client.post("/api/graph", json={"arxiv_ids": ["2301.00001", "2301.00001"]})
        assert response.status_code == 200
        assert len(response.json()["nodes"]) == 1
