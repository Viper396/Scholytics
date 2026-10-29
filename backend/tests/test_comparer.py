from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from main import app
from services import comparer


@pytest.fixture
def client():
    return TestClient(app)


def _sample_paper(aid: str, title: str, abstract: str) -> dict:
    return {
        "arxiv_id": aid,
        "title": title,
        "abstract": abstract,
        "authors": ["Researcher A", "Researcher B"],
        "published": "2024-02-10",
        "entry_url": f"https://arxiv.org/abs/{aid}",
        "pdf_url": f"https://arxiv.org/pdf/{aid}",
    }


class TestComparerLogicAndGrounding:
    def test_compare_minimum_papers_required(self):
        """Fails with ValueError if fewer than 2 papers are provided."""
        with pytest.raises(ValueError, match="At least 2 papers are required"):
            comparer.compare_papers([_sample_paper("2401.00001", "P1", "Abstract 1")])

    def test_compare_bounds_maximum_papers(self):
        """Bounds input papers to 4 max to prevent context and token overload."""
        papers = [_sample_paper(f"2401.0000{i}", f"P{i}", f"Abstract {i}") for i in range(1, 7)]

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content=json.dumps({
                        "papers": [
                            {"arxiv_id": f"2401.0000{i}", "research_question": "Q", "method": "M", "datasets_or_setup": "D", "reported_findings": "F", "limitations": "L"}
                            for i in range(1, 5)
                        ],
                        "similarities": ["Both study efficiency"],
                        "differences": ["Different training sizes"],
                        "research_gaps": ["Evaluation on low-resource languages"],
                    })
                )
            )
        ]
        mock_client.chat.completions.create.return_value = mock_response

        with patch("services.comparer._get_client", return_value=mock_client):
            res = comparer.compare_papers(papers)
            assert len(res.papers) == 4
            assert res.similarities == ["Both study efficiency"]
            assert res.differences == ["Different training sizes"]
            assert res.research_gaps == ["Evaluation on low-resource languages"]

    def test_missing_information_sanitized_to_not_reported(self):
        """Empty or placeholder fields in model output are replaced with 'Not explicitly reported in abstract'."""
        papers = [
            _sample_paper("2401.00001", "P1", "Short text."),
            _sample_paper("2401.00002", "P2", "Another text."),
        ]

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content=json.dumps({
                        "papers": [
                            {
                                "arxiv_id": "2401.00001",
                                "research_question": "Investigate attention.",
                                "method": "Linear attention.",
                                "datasets_or_setup": "N/A",  # Empty placeholder
                                "reported_findings": "2x speedup.",
                                "limitations": "",  # Empty
                            },
                            {
                                "arxiv_id": "2401.00002",
                                "research_question": "",
                                "method": "",
                                "datasets_or_setup": "Unknown",
                                "reported_findings": "None",
                                "limitations": "None",
                            },
                        ],
                        "similarities": [],
                        "differences": [],
                        "research_gaps": [],
                    })
                )
            )
        ]
        mock_client.chat.completions.create.return_value = mock_response

        with patch("services.comparer._get_client", return_value=mock_client):
            res = comparer.compare_papers(papers)
            p1 = res.papers[0]
            assert p1.datasets_or_setup == "Not explicitly reported in abstract"
            assert p1.limitations == "Not explicitly stated in abstract"

            p2 = res.papers[1]
            assert p2.research_question == "Not explicitly reported in abstract"
            assert p2.method == "Not explicitly reported in abstract"

    def test_canonical_urls_preserved_from_input(self):
        """URLs and authentic titles are populated directly from input papers, not fabricated by LLM."""
        papers = [
            _sample_paper("2401.00001", "Authentic Title 1", "Abstract 1"),
            _sample_paper("2401.00002", "Authentic Title 2", "Abstract 2"),
        ]

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content=json.dumps({
                        "papers": [
                            {"arxiv_id": "2401.00001", "research_question": "Q1", "method": "M1", "datasets_or_setup": "D1", "reported_findings": "F1", "limitations": "L1"},
                            {"arxiv_id": "2401.00002", "research_question": "Q2", "method": "M2", "datasets_or_setup": "D2", "reported_findings": "F2", "limitations": "L2"},
                        ],
                    })
                )
            )
        ]
        mock_client.chat.completions.create.return_value = mock_response

        with patch("services.comparer._get_client", return_value=mock_client):
            res = comparer.compare_papers(papers)
            assert res.papers[0].title == "Authentic Title 1"
            assert res.papers[0].entry_url == "https://arxiv.org/abs/2401.00001"
            assert res.papers[0].pdf_url == "https://arxiv.org/pdf/2401.00001"

    def test_malformed_json_extraction_fallback(self):
        """Extracts JSON enclosed in markdown code fences or conversational text."""
        raw_markdown = """
        Here is the comparative matrix:
        ```json
        {
            "papers": [
                {"arxiv_id": "2401.00001", "research_question": "Q1", "method": "M1", "datasets_or_setup": "D1", "reported_findings": "F1", "limitations": "L1"},
                {"arxiv_id": "2401.00002", "research_question": "Q2", "method": "M2", "datasets_or_setup": "D2", "reported_findings": "F2", "limitations": "L2"}
            ],
            "similarities": ["Both examine LLMs"],
            "differences": ["One is theoretical"],
            "research_gaps": ["Real-world latency"]
        }
        ```
        Hope this helps!
        """
        extracted = comparer._clean_json_response(raw_markdown)
        assert "papers" in extracted
        assert len(extracted["papers"]) == 2


class TestCompareEndpointIntegration:
    @patch("services.comparer.compare_papers")
    def test_compare_endpoint_success_with_supplied_papers(self, mock_compare, client):
        """Endpoint executes comparison using client pre-fetched papers without calling arXiv."""
        sample_papers = [
            _sample_paper("2401.00001", "Title 1", "Abstract 1"),
            _sample_paper("2401.00002", "Title 2", "Abstract 2"),
        ]

        mock_compare.return_value = comparer.ComparisonResult(
            papers=[
                comparer.PaperFeatureComparison(
                    arxiv_id="2401.00001",
                    title="Title 1",
                    entry_url="https://arxiv.org/abs/2401.00001",
                    pdf_url="https://arxiv.org/pdf/2401.00001",
                    research_question="Objective 1",
                    method="Method 1",
                    datasets_or_setup="Setup 1",
                    reported_findings="Finding 1",
                    limitations="Limitation 1",
                ),
                comparer.PaperFeatureComparison(
                    arxiv_id="2401.00002",
                    title="Title 2",
                    entry_url="https://arxiv.org/abs/2401.00002",
                    pdf_url="https://arxiv.org/pdf/2401.00002",
                    research_question="Objective 2",
                    method="Method 2",
                    datasets_or_setup="Setup 2",
                    reported_findings="Finding 2",
                    limitations="Limitation 2",
                ),
            ],
            similarities=["Common benchmark"],
            differences=["Different models"],
            research_gaps=["Exploration on long contexts"],
            disclaimer="Disclaimer text",
        )

        response = client.post("/api/papers/compare", json={
            "arxiv_ids": ["2401.00001", "2401.00002"],
            "papers": sample_papers,
            "query": "transformer optimization",
        })

        assert response.status_code == 200
        data = response.json()
        assert len(data["papers"]) == 2
        assert data["papers"][0]["arxiv_id"] == "2401.00001"
        assert data["papers"][0]["research_question"] == "Objective 1"
        assert data["similarities"] == ["Common benchmark"]

    def test_compare_endpoint_fewer_than_two_ids_fails(self, client):
        """Validation fails if fewer than 2 IDs are submitted."""
        response = client.post("/api/papers/compare", json={
            "arxiv_ids": ["2401.00001"],
        })
        assert response.status_code == 422

    @patch("services.arxiv_client.fetch_paper_by_id")
    def test_compare_endpoint_fetch_missing_fails_if_under_two(self, mock_fetch, client):
        """Returns 404 if fewer than 2 valid papers can be retrieved."""
        mock_fetch.return_value = None
        response = client.post("/api/papers/compare", json={
            "arxiv_ids": ["2401.99991", "2401.99992"],
        })
        assert response.status_code == 404

    @patch("services.comparer.compare_papers")
    def test_compare_endpoint_handles_groq_auth_failure(self, mock_compare, client):
        """Maps Groq 401 authentication errors to 502 with helpful message."""
        mock_compare.side_effect = Exception("Error code: 401 - invalid_api_key")
        sample_papers = [
            _sample_paper("2401.00001", "P1", "A1"),
            _sample_paper("2401.00002", "P2", "A2"),
        ]
        response = client.post("/api/papers/compare", json={
            "arxiv_ids": ["2401.00001", "2401.00002"],
            "papers": sample_papers,
        })
        assert response.status_code == 502
        assert "Invalid GROQ_API_KEY" in response.json()["detail"]

    @patch("services.comparer.compare_papers")
    def test_compare_endpoint_handles_groq_ratelimit(self, mock_compare, client):
        """Maps Groq 429 rate limit errors to HTTP 429."""
        mock_compare.side_effect = Exception("Error code: 429 - rate_limit_exceeded")
        sample_papers = [
            _sample_paper("2401.00001", "P1", "A1"),
            _sample_paper("2401.00002", "P2", "A2"),
        ]
        response = client.post("/api/papers/compare", json={
            "arxiv_ids": ["2401.00001", "2401.00002"],
            "papers": sample_papers,
        })
        assert response.status_code == 429
        assert "Groq rate limit reached" in response.json()["detail"]
