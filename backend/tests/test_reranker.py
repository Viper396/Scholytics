from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from services import reranker


@pytest.fixture(autouse=True)
def reset_reranker_state():
    """Reset reranker singleton state between tests."""
    original_model = reranker._MODEL
    original_enabled = reranker._ENABLE_RERANKER
    original_init_error = reranker._INIT_ERROR
    yield
    reranker._MODEL = original_model
    reranker._ENABLE_RERANKER = original_enabled
    reranker._INIT_ERROR = original_init_error


def _sample_candidates(count: int = 5) -> list[dict]:
    return [
        {
            "id": f"2301.0000{i}",
            "title": f"Paper Title {i}",
            "abstract": f"Abstract for paper {i} discussing deep neural networks.",
            "score": round(1.0 / (i + 1), 4),
        }
        for i in range(1, count + 1)
    ]


class TestRerankerConfigurationAndBypass:
    def test_reranker_disabled_by_default(self):
        """When reranker is disabled, candidate order is preserved unchanged."""
        candidates = _sample_candidates(4)
        with patch.object(reranker, "_ENABLE_RERANKER", False):
            result = reranker.rerank(query="deep learning", candidates=candidates)
            assert [c["id"] for c in result] == [c["id"] for c in candidates]

    def test_reranker_empty_query_returns_original(self):
        """Empty or whitespace-only query returns candidates up to top_k."""
        candidates = _sample_candidates(3)
        with patch.object(reranker, "_ENABLE_RERANKER", True):
            result = reranker.rerank(query="   ", candidates=candidates, top_k=2)
            assert len(result) == 2
            assert result[0]["id"] == candidates[0]["id"]

    def test_reranker_empty_candidates_returns_empty(self):
        """Empty input returns empty list."""
        assert reranker.rerank(query="test", candidates=[]) == []


class TestRerankerCandidateLimits:
    def test_candidate_limits_respected(self):
        """
        Only top max_candidates are evaluated by the cross-encoder.
        Remaining candidates preserve their original relative ranking at the end.
        """
        candidates = _sample_candidates(10)
        mock_model = MagicMock()
        # Invert the order of the first 3 candidates
        mock_model.predict.return_value = [0.1, 0.9, 0.5]

        with (
            patch.object(reranker, "_ENABLE_RERANKER", True),
            patch.object(reranker, "_get_model", return_value=mock_model),
        ):
            result = reranker.rerank(
                query="neural networks",
                candidates=candidates,
                max_candidates=3,
                top_k=10,
            )

            # Model was called only with the first 3 candidate pairs
            assert mock_model.predict.call_count == 1
            pairs_called = mock_model.predict.call_args[0][0]
            assert len(pairs_called) == 3

            # First 3 candidates are re-ordered by cross-encoder scores (2nd > 3rd > 1st)
            assert result[0]["id"] == candidates[1]["id"]  # score 0.9
            assert result[1]["id"] == candidates[2]["id"]  # score 0.5
            assert result[2]["id"] == candidates[0]["id"]  # score 0.1

            # Candidates beyond index 3 retain their original order
            for i in range(3, 10):
                assert result[i]["id"] == candidates[i]["id"]


class TestRerankerRobustnessAndEdgeCases:
    def test_missing_text_does_not_crash(self):
        """Candidates with missing or empty title/abstract are handled cleanly."""
        candidates = [
            {"id": "doc1", "title": "", "abstract": ""},
            {"id": "doc2", "metadata": {}},
            {"id": "doc3", "title": "Valid Title", "abstract": "Valid abstract"},
        ]
        mock_model = MagicMock()
        mock_model.predict.return_value = [0.0, -1.0, 5.0]

        with (
            patch.object(reranker, "_ENABLE_RERANKER", True),
            patch.object(reranker, "_get_model", return_value=mock_model),
        ):
            result = reranker.rerank(query="search query", candidates=candidates)
            assert len(result) == 3
            assert result[0]["id"] == "doc3"  # Highest score 5.0

    def test_invalid_scores_sanitized(self):
        """NaN, inf, or unparseable scores are safely sanitized to 0.0."""
        assert reranker._sanitize_score(float("nan")) == 0.0
        assert reranker._sanitize_score(float("inf")) == 0.0
        assert reranker._sanitize_score("-inf") == 0.0
        assert reranker._sanitize_score("not_a_number") == 0.0
        assert reranker._sanitize_score(4.5) == 4.5

    def test_reranker_prediction_failure_falls_back(self):
        """When model.predict() raises an exception, safely returns original order."""
        candidates = _sample_candidates(4)
        mock_model = MagicMock()
        mock_model.predict.side_effect = RuntimeError("CUDA out of memory or ONNX failure")

        with (
            patch.object(reranker, "_ENABLE_RERANKER", True),
            patch.object(reranker, "_get_model", return_value=mock_model),
        ):
            result = reranker.rerank(query="query", candidates=candidates)
            assert [c["id"] for c in result] == [c["id"] for c in candidates]

    def test_reranker_model_unavailable_falls_back(self):
        """When model cannot be loaded, returns original candidate ordering."""
        candidates = _sample_candidates(3)
        with (
            patch.object(reranker, "_ENABLE_RERANKER", True),
            patch.object(reranker, "_get_model", return_value=None),
        ):
            result = reranker.rerank(query="query", candidates=candidates)
            assert [c["id"] for c in result] == [c["id"] for c in candidates]


class TestRerankerLifecycleAndDiagnostics:
    def test_warm_up_disabled(self):
        with patch.object(reranker, "_ENABLE_RERANKER", False):
            assert reranker.warm_up() is False

    def test_warm_up_enabled(self):
        with (
            patch.object(reranker, "_ENABLE_RERANKER", True),
            patch.object(reranker, "_get_model", return_value=MagicMock()),
        ):
            assert reranker.warm_up() is True

    def test_get_status_diagnostics(self):
        status = reranker.get_status()
        assert "enabled" in status
        assert "model" in status
        assert "available" in status
        assert "loaded" in status
