from __future__ import annotations

import asyncio
import time
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from main import app
from services import arxiv_client, cache, embedder
from services.cache import (
    BoundedLRU,
    build_compare_cache_key,
    build_paper_cache_key,
    build_query_embedding_cache_key,
    build_search_cache_key,
    build_summary_cache_key,
    clear_all_caches,
    get_all_cache_stats,
    is_cache_enabled,
)


@pytest.fixture
def client():
    clear_all_caches()
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_cache():
    clear_all_caches()
    yield
    clear_all_caches()


class TestBoundedLRUCore:
    def test_lru_evicts_oldest_when_at_capacity(self):
        """When capacity is reached, least recently used item is evicted."""
        lru: BoundedLRU[str, str] = BoundedLRU(name="test", maxsize=3, default_ttl=3600.0)
        lru.set("a", "alpha")
        lru.set("b", "beta")
        lru.set("c", "gamma")

        # Access "a" so "b" becomes the least recently used
        assert lru.get("a") == "alpha"

        # Insert "d" — should evict "b"
        lru.set("d", "delta")

        assert lru.get("b") is None  # evicted
        assert lru.get("a") == "alpha"
        assert lru.get("c") == "gamma"
        assert lru.get("d") == "delta"
        assert lru.stats()["evictions"] == 1
        assert lru.stats()["size"] == 3

    def test_lru_expires_entries_after_ttl(self):
        """Entries past their TTL return None and are pruned."""
        lru: BoundedLRU[str, str] = BoundedLRU(name="test", maxsize=5, default_ttl=0.05)
        lru.set("key1", "val1")

        # Immediately available
        assert lru.get("key1") == "val1"

        # Wait for expiration
        time.sleep(0.07)

        # Access after TTL expires
        assert lru.get("key1") is None
        assert lru.stats()["expirations"] == 1

    def test_cache_invalidation_delete_and_clear(self):
        """Individual delete and bulk clear evict keys correctly."""
        lru: BoundedLRU[str, int] = BoundedLRU(name="test", maxsize=10)
        lru.set("x", 10)
        lru.set("y", 20)

        assert lru.delete("x") is True
        assert lru.get("x") is None
        assert lru.get("y") == 20

        lru.clear()
        assert lru.get("y") is None
        assert lru.stats()["size"] == 0

    def test_disabled_cache_returns_none(self, monkeypatch):
        """When ENABLE_CACHE=false, get always returns None and set is ignored."""
        monkeypatch.setenv("ENABLE_CACHE", "false")
        lru: BoundedLRU[str, str] = BoundedLRU(name="test", maxsize=10)
        lru.set("k", "v")
        assert lru.get("k") is None


class TestSingleFlightDeduplication:
    @pytest.mark.asyncio
    async def test_async_single_flight_coalesces_concurrent_calls(self):
        """Multiple concurrent callers for identical key execute coroutine only once."""
        single_flight = cache.AsyncSingleFlight()
        execution_count = 0

        async def expensive_work():
            nonlocal execution_count
            execution_count += 1
            await asyncio.sleep(0.05)
            return "computed_result"

        # Launch 5 concurrent calls for the exact same key
        results = await asyncio.gather(
            single_flight.execute("same_key", expensive_work),
            single_flight.execute("same_key", expensive_work),
            single_flight.execute("same_key", expensive_work),
            single_flight.execute("same_key", expensive_work),
            single_flight.execute("same_key", expensive_work),
        )

        assert results == ["computed_result"] * 5
        assert execution_count == 1  # Only executed once!

    @pytest.mark.asyncio
    async def test_async_single_flight_propagates_exceptions_without_caching(self):
        """Exceptions in single-flight are propagated and not stored."""
        single_flight = cache.AsyncSingleFlight()
        call_count = 0

        async def failing_work():
            nonlocal call_count
            call_count += 1
            await asyncio.sleep(0.01)
            raise RuntimeError("Upstream failure")

        with pytest.raises(RuntimeError, match="Upstream failure"):
            await asyncio.gather(
                single_flight.execute("err_key", failing_work),
                single_flight.execute("err_key", failing_work),
            )

        assert call_count == 1
        # Subsequent call should retry and not return a stale error
        async def succeeding_work():
            return "recovered"

        res = await single_flight.execute("err_key", succeeding_work)
        assert res == "recovered"


class TestKeyBuildersAndSafety:
    def test_search_cache_key_varies_with_filters(self):
        """Search cache keys differ when date or categories change."""
        k1 = build_search_cache_key("quantum", 10, {"date_from": "2023-01-01"})
        k2 = build_search_cache_key("quantum", 10, {"date_from": "2024-01-01"})
        k3 = build_search_cache_key("quantum", 10, {"categories": ["cs.AI"]})
        k4 = build_search_cache_key("quantum", 10, {"categories": ["cs.LG"]})
        k5 = build_search_cache_key("quantum", 5, None)

        keys = {k1, k2, k3, k4, k5}
        assert len(keys) == 5  # all distinct

    def test_summary_cache_key_incorporates_content_hash(self):
        """Edits to title or abstract automatically invalidate old summary keys."""
        k1 = build_summary_cache_key("2401.00001", "Title A", "Abstract text 1")
        k2 = build_summary_cache_key("2401.00001", "Title A", "Abstract text 2 (modified)")
        assert k1 != k2


class TestArxivAndEmbeddingCachingIntegration:
    @patch("services.arxiv_client._MAX_RETRIES", 1)
    def test_arxiv_client_caches_repeated_searches(self):
        """Repeated arXiv queries return cached results without calling arXiv API again."""
        mock_papers = [{"arxiv_id": "2401.00001", "title": "Paper 1", "abstract": "A"}]

        with patch("services.arxiv_client.arxiv.Search") as mock_search, \
             patch("services.arxiv_client.arxiv.Client") as mock_client_cls:
            mock_client = MagicMock()
            mock_result = MagicMock()
            mock_result.get_short_id.return_value = "2401.00001"
            mock_result.title = "Paper 1"
            mock_result.summary = "A"
            mock_result.authors = [MagicMock(name="Author")]
            mock_result.published = MagicMock()
            mock_result.published.date.return_value.isoformat.return_value = "2024-01-01"
            mock_result.categories = ["cs.AI"]
            mock_result.pdf_url = "http://pdf"
            mock_result.entry_id = "http://abs"

            mock_client.results.return_value = [mock_result]
            mock_client_cls.return_value = mock_client

            # First search: network hit
            res1 = arxiv_client.search_papers("transformer", max_results=5)
            assert len(res1) == 1
            assert mock_client.results.call_count == 1

            # Second search: cached hit
            res2 = arxiv_client.search_papers("transformer", max_results=5)
            assert len(res2) == 1
            assert mock_client.results.call_count == 1  # Unchanged!

    def test_query_embedding_cached(self):
        """Embedding the same query multiple times uses cached vector."""
        q = "efficient self-attention mechanisms"
        vec1 = embedder.embed_query(q)
        assert len(vec1) == 384

        # Check telemetry
        stats = cache.query_embedding_cache.stats()
        assert stats["size"] == 1

        # Second call hits cache
        vec2 = embedder.embed_query(q)
        assert vec1 == vec2
        assert cache.query_embedding_cache.stats()["hits"] == 1


class TestApiEndpointsWithCaching:
    @patch("services.arxiv_client.arxiv.Client")
    def test_search_endpoint_caches_arxiv_results(self, mock_client_cls, client):
        """POST /api/search caches arXiv discovery; second hit avoids upstream network request."""
        mock_client = MagicMock()
        mock_result = MagicMock()
        mock_result.get_short_id.return_value = "2401.12345"
        mock_result.title = "Quantum Error Bounds"
        mock_result.summary = "We bound errors in NISQ circuits."
        mock_result.authors = [MagicMock(name="Scientist")]
        mock_result.published = MagicMock()
        mock_result.published.date.return_value.isoformat.return_value = "2024-01-15"
        mock_result.categories = ["cs.AI"]
        mock_result.pdf_url = "https://arxiv.org/pdf/2401.12345"
        mock_result.entry_id = "https://arxiv.org/abs/2401.12345"

        mock_client.results.return_value = [mock_result]
        mock_client_cls.return_value = mock_client

        # First search: queries arXiv
        resp1 = client.post("/api/search", json={"query": "quantum error bounds", "max_results": 5})
        assert resp1.status_code == 200
        data1 = resp1.json()
        assert len(data1["results"]) == 1
        assert mock_client.results.call_count == 1

        # Second search: hits arxiv_search_cache, does not call arXiv client again
        resp2 = client.post("/api/search", json={"query": "quantum error bounds", "max_results": 5})
        assert resp2.status_code == 200
        data2 = resp2.json()
        assert len(data2["results"]) == 1
        assert mock_client.results.call_count == 1  # Unchanged!

    @patch("services.summarizer._get_client")
    def test_paper_summary_caches_llm_generation(self, mock_get_client, client):
        """Summarizing a paper caches the result and avoids re-calling Groq on identical input."""
        mock_groq = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock(message=MagicMock(content="Concise summary from Groq."))]
        mock_groq.chat.completions.create.return_value = mock_response
        mock_get_client.return_value = mock_groq

        # First request: invokes Groq
        resp1 = client.post("/api/papers/2401.00001/summarize", json={
            "title": "Title 1",
            "abstract": "Abstract 1",
        })
        assert resp1.status_code == 200
        assert resp1.json()["summary"] == "Concise summary from Groq."
        assert mock_groq.chat.completions.create.call_count == 1

        # Second request: served from paper_summary_cache
        resp2 = client.post("/api/papers/2401.00001/summarize", json={
            "title": "Title 1",
            "abstract": "Abstract 1",
        })
        assert resp2.status_code == 200
        assert resp2.json()["summary"] == "Concise summary from Groq."
        assert mock_groq.chat.completions.create.call_count == 1  # Not invoked again!

    def test_cache_stats_and_clear_endpoints(self, client):
        """GET /api/cache/stats and POST /api/cache/clear operate properly."""
        stats_resp = client.get("/api/cache/stats")
        assert stats_resp.status_code == 200
        stats = stats_resp.json()
        assert "total_entries" in stats
        assert "caches" in stats

        clear_resp = client.post("/api/cache/clear")
        assert clear_resp.status_code == 200
        assert clear_resp.json() == {"status": "cleared"}
