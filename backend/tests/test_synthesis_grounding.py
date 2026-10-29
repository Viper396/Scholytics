from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from main import app
from services import summarizer


@pytest.fixture
def client():
    return TestClient(app)


def _make_sample_paper(arxiv_id: str, title: str = "Test Title", abstract: str = "Test Abstract") -> dict:
    return {
        "arxiv_id": arxiv_id,
        "title": title,
        "abstract": abstract,
        "authors": ["Alice Smith", "Bob Jones"],
        "published": "2023-01-15",
        "categories": ["cs.AI", "cs.LG"],
        "entry_url": f"https://arxiv.org/abs/{arxiv_id}",
        "pdf_url": f"https://arxiv.org/pdf/{arxiv_id}",
    }


class TestSourceRecordsAndContextBuilding:
    def test_build_source_records_metadata(self):
        """Constructs structured metadata with stable IDs, URLs, and abstract flags."""
        papers = [
            _make_sample_paper("2301.00001", "Paper 1", "Abstract 1"),
            _make_sample_paper("2301.00002", "Paper 2", ""),  # missing abstract
        ]
        records = summarizer.build_source_records(papers, max_papers=5)

        assert len(records) == 2
        assert records[0]["source_index"] == 1
        assert records[0]["arxiv_id"] == "2301.00001"
        assert records[0]["title"] == "Paper 1"
        assert records[0]["entry_url"] == "https://arxiv.org/abs/2301.00001"
        assert records[0]["pdf_url"] == "https://arxiv.org/pdf/2301.00001"
        assert records[0]["has_abstract"] is True
        assert records[0]["authors"] == ["Alice Smith", "Bob Jones"]

        # Missing abstract is explicitly noted
        assert records[1]["source_index"] == 2
        assert records[1]["has_abstract"] is False

    def test_build_papers_context_bounds_and_missing_abstract(self):
        """Context builder bounds texts and notes missing abstracts."""
        papers = [
            {"arxiv_id": "2301.00001", "title": "P1", "abstract": ""},
            {"arxiv_id": "2301.00002", "title": "P2", "abstract": "Valid abstract content."},
        ]
        context = summarizer._build_papers_context(papers, max_papers=2)
        assert "[SOURCE 1] arXiv:2301.00001" in context
        assert "[Abstract unavailable; evaluate from title and context only]" in context
        assert "[SOURCE 2] arXiv:2301.00002" in context
        assert "Valid abstract content." in context


class TestCitationValidation:
    def test_validate_citations_all_valid(self):
        """All citations present within valid set are recognized."""
        text = "Recent work [SOURCE 1] demonstrates scaling. Another approach [SOURCE 2] confirms this."
        valid_indices = {1, 2, 3}
        val = summarizer.validate_citations(text, valid_indices)

        assert val["cited_sources"] == [1, 2]
        assert val["invalid_citations"] == []
        assert val["has_hallucinations"] is False
        assert val["citation_count"] == 2

    def test_validate_citations_detects_hallucinations(self):
        """Citations referencing out-of-bound source indices are flagged as hallucinations."""
        text = "This claim relies on [SOURCE 1] and an ungrounded finding [SOURCE 8]."
        valid_indices = {1, 2, 3}  # Only 3 sources provided
        val = summarizer.validate_citations(text, valid_indices)

        assert val["cited_sources"] == [1]
        assert val["invalid_citations"] == [8]
        assert val["has_hallucinations"] is True

    def test_validate_citations_empty_or_no_citations(self):
        """Text without citations returns empty sets without error."""
        text = "A general summary without inline markers."
        val = summarizer.validate_citations(text, {1, 2})

        assert val["cited_sources"] == []
        assert val["invalid_citations"] == []
        assert val["has_hallucinations"] is False
        assert val["citation_count"] == 0


class TestSynthesisStreamingGrounding:
    @patch("services.summarizer.generate_search_summary")
    def test_streaming_emits_sources_and_validation_events(self, mock_gen, client):
        """Stream must emit sources, tokens, validation report, and done events."""
        mock_gen.return_value = iter([
            "Transformers [SOURCE 1] are scalable. ",
            "Sparse attention [SOURCE 2] reduces memory.",
        ])
        sample_papers = [
            _make_sample_paper("2301.00001", "Paper 1"),
            _make_sample_paper("2301.00002", "Paper 2"),
        ]

        response = client.post("/api/search/synthesize", json={
            "query": "scalable transformers",
            "arxiv_ids": ["2301.00001", "2301.00002"],
            "papers": sample_papers,
        })

        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]
        body = response.text

        # 1. Sources event
        assert "event: sources" in body
        assert "2301.00001" in body
        assert "2301.00002" in body

        # 2. Token data lines
        assert "data: Transformers [SOURCE 1] are scalable." in body

        # 3. Validation event
        assert "event: validation" in body
        assert '"cited_sources": [1, 2]' in body
        assert '"has_hallucinations": false' in body

        # 4. Completion event
        assert "event: done" in body
        assert "data: [DONE]" in body

    @patch("services.summarizer.generate_search_summary")
    def test_streaming_handles_rate_limit_error(self, mock_gen, client):
        """Groq rate limit during streaming emits actionable error event."""
        def raise_ratelimit(*args, **kwargs):
            raise RuntimeError("Error code: 429 - {'error': {'message': 'Rate limit reached'}}")

        mock_gen.side_effect = raise_ratelimit
        sample_papers = [_make_sample_paper("2301.00001")]

        response = client.post("/api/search/synthesize", json={
            "query": "test",
            "arxiv_ids": ["2301.00001"],
            "papers": sample_papers,
        })

        assert response.status_code == 200
        body = response.text
        assert "event: error" in body
        assert "Groq rate limit reached" in body

    @patch("services.summarizer.generate_search_summary")
    def test_streaming_handles_auth_error(self, mock_gen, client):
        """Groq 401 auth error emits clear actionable error event."""
        def raise_auth(*args, **kwargs):
            raise RuntimeError("Error code: 401 - {'error': {'message': 'Invalid API Key'}}")

        mock_gen.side_effect = raise_auth
        sample_papers = [_make_sample_paper("2301.00001")]

        response = client.post("/api/search/synthesize", json={
            "query": "test",
            "arxiv_ids": ["2301.00001"],
            "papers": sample_papers,
        })

        assert response.status_code == 200
        body = response.text
        assert "event: error" in body
        assert "Groq authentication failed" in body
