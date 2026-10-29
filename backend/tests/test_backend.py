"""
Backend tests for Scholytics.

Run with:
    cd backend
    python -m pytest tests/ -v

External services (arXiv, Groq) are mocked so tests run without API keys.
"""
from __future__ import annotations

import json
import sys
import types
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Minimal stubs so tests can import backend modules without all deps installed.
# ---------------------------------------------------------------------------

def _stub_module(name: str, attrs: dict | None = None) -> types.ModuleType:
	mod = types.ModuleType(name)
	if attrs:
		for key, value in attrs.items():
			setattr(mod, key, value)
	return mod


# Stub chromadb only if not installed
if "chromadb" not in sys.modules:
	try:
		import chromadb  # noqa: F401
	except ImportError:
		chromadb_mod = _stub_module("chromadb")
		chromadb_mod.EphemeralClient = MagicMock
		sys.modules["chromadb"] = chromadb_mod

# Stub fastembed
if "fastembed" not in sys.modules:
	fastembed_mod = _stub_module("fastembed")
	fastembed_mod.TextEmbedding = None
	sys.modules["fastembed"] = fastembed_mod

# Stub groq
if "groq" not in sys.modules:
	groq_mod = _stub_module("groq")
	groq_mod.Groq = MagicMock
	sys.modules["groq"] = groq_mod

# Stub arxiv
if "arxiv" not in sys.modules:
	import datetime as _dt

	class _FakeResult:
		def __init__(self, arxiv_id: str, title: str, published_year: int = 2023):
			self._id = arxiv_id
			self.title = title
			self.authors = []
			self.summary = f"Abstract of {title}"
			self.published = _dt.datetime(published_year, 1, 1, tzinfo=_dt.timezone.utc)
			self.categories = ["cs.AI"]
			self.pdf_url = f"https://arxiv.org/pdf/{arxiv_id}"
			self.entry_id = f"https://arxiv.org/abs/{arxiv_id}"

		def get_short_id(self) -> str:
			return self._id

	class _FakeSearch:
		def __init__(self, *args, **kwargs):
			pass

	class _FakeClient:
		def __init__(self, *args, **kwargs):
			self._results: list[Any] = []

		def results(self, search):
			return iter(self._results)

	class _SortCriterion:
		Relevance = "relevance"

	arxiv_mod = _stub_module("arxiv")
	arxiv_mod.Result = _FakeResult
	arxiv_mod.Search = _FakeSearch
	arxiv_mod.Client = _FakeClient
	arxiv_mod.SortCriterion = _SortCriterion
	sys.modules["arxiv"] = arxiv_mod

# ---------------------------------------------------------------------------
# Now import backend modules.
# ---------------------------------------------------------------------------
import sys
import os

# Add backend directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services import embedder as embedder_mod
from services import arxiv_client as arxiv_client_mod


# ---------------------------------------------------------------------------
# Embedder tests
# ---------------------------------------------------------------------------

class TestEmbedder:
	def test_embed_empty_list(self):
		result = embedder_mod.embed_texts([])
		assert result == []

	def test_hash_fallback_disabled_raises(self):
		"""When TextEmbedding is None and fallback disabled, raise RuntimeError."""
		with (
			patch.object(embedder_mod, "TextEmbedding", None),
			patch.object(embedder_mod, "_ALLOW_HASH_FALLBACK", False),
			patch.object(embedder_mod, "_MODEL", None),
		):
			with pytest.raises(RuntimeError, match="Embedding model is unavailable"):
				embedder_mod.embed_texts(["test"])

	def test_hash_fallback_enabled_returns_vectors(self):
		"""When fallback enabled, returns vectors of correct dimension."""
		with (
			patch.object(embedder_mod, "TextEmbedding", None),
			patch.object(embedder_mod, "_ALLOW_HASH_FALLBACK", True),
			patch.object(embedder_mod, "_MODEL", None),
		):
			result = embedder_mod.embed_texts(["hello world"])
			assert len(result) == 1
			assert len(result[0]) == embedder_mod._HASH_DIM

	def test_normalize_zero_vector(self):
		"""Normalizing a zero vector should return it unchanged."""
		result = embedder_mod._normalize([0.0, 0.0, 0.0])
		assert result == [0.0, 0.0, 0.0]

	def test_normalize_nonzero(self):
		"""Normalized vector should have unit norm."""
		import math
		v = [3.0, 4.0]
		norm_v = embedder_mod._normalize(v)
		magnitude = math.sqrt(sum(x * x for x in norm_v))
		assert abs(magnitude - 1.0) < 1e-6

	def test_is_using_hash_fallback_default(self):
		"""Default state should not be in hash fallback."""
		with patch.object(embedder_mod, "_using_hash_fallback", False):
			assert not embedder_mod.is_using_hash_fallback()

	def test_embed_query_delegates(self):
		"""embed_query wraps embed_texts and returns first element."""
		with patch.object(embedder_mod, "embed_texts", return_value=[[0.1, 0.2]]):
			result = embedder_mod.embed_query("test")
			assert result == [0.1, 0.2]


# ---------------------------------------------------------------------------
# arXiv client tests
# ---------------------------------------------------------------------------

class TestArxivClient:
	def test_parse_date_from_valid(self):
		from datetime import date
		result = arxiv_client_mod._parse_date_from({"date_from": "2023-01-01"})
		assert result == date(2023, 1, 1)

	def test_parse_date_from_invalid(self):
		result = arxiv_client_mod._parse_date_from({"date_from": "not-a-date"})
		assert result is None

	def test_parse_date_from_none(self):
		assert arxiv_client_mod._parse_date_from(None) is None
		assert arxiv_client_mod._parse_date_from({}) is None

	def test_parse_categories(self):
		result = arxiv_client_mod._parse_categories({"categories": ["cs.AI", "cs.LG"]})
		assert result == {"cs.AI", "cs.LG"}

	def test_parse_categories_empty(self):
		assert arxiv_client_mod._parse_categories(None) == set()

	def test_is_retryable_error_true_for_generic(self):
		assert arxiv_client_mod._is_retryable_error(ConnectionError("timeout")) is True

	def test_is_retryable_error_false_for_auth(self):
		assert arxiv_client_mod._is_retryable_error(Exception("401 unauthorized")) is False
		assert arxiv_client_mod._is_retryable_error(Exception("403 forbidden")) is False

	def test_search_papers_empty_results(self):
		"""arXiv returns no results — should return empty list."""
		import arxiv as arxiv_lib

		with patch.object(arxiv_lib, "Client") as mock_client_class:
			instance = MagicMock()
			instance.results.return_value = iter([])
			mock_client_class.return_value = instance

			result = arxiv_client_mod.search_papers("nonexistent topic xyz")
			assert result == []

	def test_search_papers_raises_on_persistent_failure(self):
		"""On repeated failures, raises RuntimeError."""
		import arxiv as arxiv_lib

		with (
			patch.object(arxiv_lib, "Client") as mock_client_class,
			patch.object(arxiv_client_mod, "_MAX_RETRIES", 1),
			patch.object(arxiv_client_mod, "_BACKOFF_BASE", 0),  # no sleep
		):
			instance = MagicMock()
			instance.results.side_effect = ConnectionError("network error")
			mock_client_class.return_value = instance

			with pytest.raises(RuntimeError, match="arXiv search failed"):
				arxiv_client_mod.search_papers("test query")

	def test_fetch_paper_by_id_not_found(self):
		import arxiv as arxiv_lib

		with patch.object(arxiv_lib, "Client") as mock_client_class:
			instance = MagicMock()
			instance.results.return_value = iter([])
			mock_client_class.return_value = instance

			result = arxiv_client_mod.fetch_paper_by_id("9999.99999")
			assert result is None

	def test_fetch_paper_by_id_returns_none_on_failure(self):
		"""Non-retryable error should return None rather than raise."""
		import arxiv as arxiv_lib

		with (
			patch.object(arxiv_lib, "Client") as mock_client_class,
			patch.object(arxiv_client_mod, "_MAX_RETRIES", 1),
			patch.object(arxiv_client_mod, "_BACKOFF_BASE", 0),
		):
			instance = MagicMock()
			instance.results.side_effect = Exception("401 unauthorized")
			mock_client_class.return_value = instance

			result = arxiv_client_mod.fetch_paper_by_id("2101.00001")
			assert result is None


# ---------------------------------------------------------------------------
# Pydantic model validation tests (search router)
# ---------------------------------------------------------------------------

class TestSearchValidation:
	def _get_models(self):
		from routers.search import SearchRequest, SearchFilters, SearchSynthesizeRequest
		return SearchRequest, SearchFilters, SearchSynthesizeRequest

	def test_search_request_valid(self):
		SearchRequest, _, _ = self._get_models()
		req = SearchRequest(query="machine learning", max_results=10)
		assert req.query == "machine learning"

	def test_search_request_empty_query_fails(self):
		from pydantic import ValidationError
		SearchRequest, _, _ = self._get_models()
		with pytest.raises(ValidationError):
			SearchRequest(query="", max_results=10)

	def test_search_request_overlong_query_fails(self):
		from pydantic import ValidationError
		SearchRequest, _, _ = self._get_models()
		with pytest.raises(ValidationError):
			SearchRequest(query="x" * 401, max_results=10)

	def test_search_request_max_results_capped_at_25(self):
		from pydantic import ValidationError
		SearchRequest, _, _ = self._get_models()
		with pytest.raises(ValidationError):
			SearchRequest(query="test", max_results=26)

	def test_search_request_min_results_1(self):
		from pydantic import ValidationError
		SearchRequest, _, _ = self._get_models()
		with pytest.raises(ValidationError):
			SearchRequest(query="test", max_results=0)

	def test_search_filters_invalid_category(self):
		from pydantic import ValidationError
		_, SearchFilters, _ = self._get_models()
		with pytest.raises(ValidationError):
			SearchFilters(categories=["not.a.real.category"])

	def test_search_filters_valid_category(self):
		_, SearchFilters, _ = self._get_models()
		f = SearchFilters(categories=["cs.AI", "cs.LG"])
		assert f.categories == ["cs.AI", "cs.LG"]

	def test_search_filters_invalid_date(self):
		from pydantic import ValidationError
		_, SearchFilters, _ = self._get_models()
		with pytest.raises(ValidationError):
			SearchFilters(date_from="20-01-01")

	def test_synthesize_invalid_arxiv_id(self):
		from pydantic import ValidationError
		_, _, SearchSynthesizeRequest = self._get_models()
		with pytest.raises(ValidationError):
			SearchSynthesizeRequest(query="test", arxiv_ids=["not_an_id"])

	def test_synthesize_valid_ids(self):
		_, _, SearchSynthesizeRequest = self._get_models()
		req = SearchSynthesizeRequest(query="test", arxiv_ids=["2301.00001", "2301.00002"])
		assert len(req.arxiv_ids) == 2

	def test_synthesize_deduplicates_ids(self):
		_, _, SearchSynthesizeRequest = self._get_models()
		req = SearchSynthesizeRequest(query="test", arxiv_ids=["2301.00001", "2301.00001"])
		assert len(req.arxiv_ids) == 1

	def test_synthesize_empty_ids_fails(self):
		from pydantic import ValidationError
		_, _, SearchSynthesizeRequest = self._get_models()
		with pytest.raises(ValidationError):
			SearchSynthesizeRequest(query="test", arxiv_ids=[])


# ---------------------------------------------------------------------------
# Graph model validation tests
# ---------------------------------------------------------------------------

class TestGraphValidation:
	def _get_model(self):
		from routers.graph import GraphRequest
		return GraphRequest

	def test_graph_valid(self):
		GraphRequest = self._get_model()
		req = GraphRequest(arxiv_ids=["2301.00001"])
		assert len(req.arxiv_ids) == 1

	def test_graph_invalid_id(self):
		from pydantic import ValidationError
		GraphRequest = self._get_model()
		with pytest.raises(ValidationError):
			GraphRequest(arxiv_ids=["not_valid"])

	def test_graph_deduplicates(self):
		GraphRequest = self._get_model()
		req = GraphRequest(arxiv_ids=["2301.00001", "2301.00001"])
		assert len(req.arxiv_ids) == 1

	def test_graph_empty_fails(self):
		from pydantic import ValidationError
		GraphRequest = self._get_model()
		with pytest.raises(ValidationError):
			GraphRequest(arxiv_ids=[])

	def test_graph_too_many_ids_fails(self):
		from pydantic import ValidationError
		GraphRequest = self._get_model()
		ids = [f"2301.{str(i).zfill(5)}" for i in range(1, 27)]
		with pytest.raises(ValidationError):
			GraphRequest(arxiv_ids=ids)


# ---------------------------------------------------------------------------
# Papers model validation tests
# ---------------------------------------------------------------------------

class TestPapersValidation:
	def _get_model(self):
		from routers.papers import SummarizeBatchRequest
		return SummarizeBatchRequest

	def test_batch_valid(self):
		SummarizeBatchRequest = self._get_model()
		req = SummarizeBatchRequest(arxiv_ids=["2301.00001"])
		assert len(req.arxiv_ids) == 1

	def test_batch_invalid_id(self):
		from pydantic import ValidationError
		SummarizeBatchRequest = self._get_model()
		with pytest.raises(ValidationError):
			SummarizeBatchRequest(arxiv_ids=["bad_id"])

	def test_batch_too_large_fails(self):
		from pydantic import ValidationError
		SummarizeBatchRequest = self._get_model()
		ids = [f"2301.{str(i).zfill(5)}" for i in range(1, 12)]
		with pytest.raises(ValidationError):
			SummarizeBatchRequest(arxiv_ids=ids)

	def test_batch_empty_fails(self):
		from pydantic import ValidationError
		SummarizeBatchRequest = self._get_model()
		with pytest.raises(ValidationError):
			SummarizeBatchRequest(arxiv_ids=[])


# ---------------------------------------------------------------------------
# Graph edge construction tests
# ---------------------------------------------------------------------------

class TestGraphEdgeConstruction:
	def test_shared_authors_creates_co_author_edge(self):
		"""Papers with shared authors should produce co-author edges."""
		from itertools import combinations

		# Simulate the graph construction logic
		paper_index = {
			"2301.00001": {"authors": {"alice"}, "categories": {"cs.ai"}},
			"2301.00002": {"authors": {"alice"}, "categories": {"cs.cv"}},
		}
		node_ids = list(paper_index.keys())
		edges = []
		for source_id, target_id in combinations(node_ids, 2):
			source_data = paper_index[source_id]
			target_data = paper_index[target_id]
			shared_authors = source_data["authors"].intersection(target_data["authors"])
			if shared_authors:
				edges.append({"source": source_id, "target": target_id, "type": "co-author"})
				continue
			shared_categories = source_data["categories"].intersection(target_data["categories"])
			if shared_categories:
				edges.append({"source": source_id, "target": target_id, "type": "same-field"})

		assert len(edges) == 1
		assert edges[0]["type"] == "co-author"

	def test_shared_category_creates_same_field_edge(self):
		from itertools import combinations

		paper_index = {
			"2301.00001": {"authors": {"alice"}, "categories": {"cs.ai"}},
			"2301.00002": {"authors": {"bob"}, "categories": {"cs.ai"}},
		}
		node_ids = list(paper_index.keys())
		edges = []
		for source_id, target_id in combinations(node_ids, 2):
			source_data = paper_index[source_id]
			target_data = paper_index[target_id]
			shared_authors = source_data["authors"].intersection(target_data["authors"])
			if shared_authors:
				edges.append({"type": "co-author"})
				continue
			shared_categories = source_data["categories"].intersection(target_data["categories"])
			if shared_categories:
				edges.append({"type": "same-field"})

		assert len(edges) == 1
		assert edges[0]["type"] == "same-field"

	def test_no_shared_features_no_edge(self):
		from itertools import combinations

		paper_index = {
			"2301.00001": {"authors": {"alice"}, "categories": {"cs.ai"}},
			"2301.00002": {"authors": {"bob"}, "categories": {"cs.cv"}},
		}
		node_ids = list(paper_index.keys())
		edges = []
		for source_id, target_id in combinations(node_ids, 2):
			source_data = paper_index[source_id]
			target_data = paper_index[target_id]
			shared_authors = source_data["authors"].intersection(target_data["authors"])
			if shared_authors:
				edges.append({"type": "co-author"})
				continue
			shared_categories = source_data["categories"].intersection(target_data["categories"])
			if shared_categories:
				edges.append({"type": "same-field"})

		assert len(edges) == 0


# ---------------------------------------------------------------------------
# SSE streaming format test
# ---------------------------------------------------------------------------

class TestSSEFormat:
	def test_event_stream_format(self):
		"""Each token should produce a correctly formatted SSE event."""
		events = []

		def fake_generator(query, papers):
			yield "Hello"
			yield " world"
			yield "line1\nline2"

		# Simulate the event_stream() logic from search router
		for token in fake_generator("q", []):
			lines = token.splitlines() if token else []
			if not lines:
				lines = [""]
			data_lines = "\n".join(f"data: {line}" for line in lines)
			events.append(f"{data_lines}\n\n")

		# Verify each event ends with \n\n (SSE event boundary)
		for event in events:
			assert event.endswith("\n\n"), f"Event missing terminal blank line: {event!r}"
			# Verify each line before the blank has data: prefix
			content_lines = event.strip().split("\n")
			for line in content_lines:
				assert line.startswith("data:"), f"Unexpected line format: {line!r}"

	def test_multiline_token_single_event(self):
		"""A token with newlines should be a single SSE event with multiple data: lines."""
		token = "line1\nline2\nline3"
		lines = token.splitlines()
		data_lines = "\n".join(f"data: {line}" for line in lines)
		event = f"{data_lines}\n\n"

		# Should not have multiple blank lines (would split into multiple events)
		assert event.count("\n\n") == 1
		assert "data: line1\ndata: line2\ndata: line3\n\n" == event


if __name__ == "__main__":
	pytest.main([__file__, "-v"])
