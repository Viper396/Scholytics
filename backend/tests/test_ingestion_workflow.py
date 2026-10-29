"""
Comprehensive unit tests for the paper discovery and ingestion workflow.

Tests verify:
1. Idempotency and duplicate prevention (re-embedding is avoided when papers already exist).
2. arXiv version update policy (v1 -> v2 triggers re-indexing under the canonical ID).
3. Content fingerprint change detection (hash of title + abstract).
4. Concurrency coordinator (in-flight tracking prevents parallel duplicate embedding).
5. Bounded batch size enforcement.
6. Graceful partial failure handling (locks released even if embedding fails).
7. Search route integration with incremental ingestion.
8. Ingestion endpoints (/api/ingest and /api/ingest/status).
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from db.chroma_adapter import ChromaAdapter
from db.vector_store import (
    compute_paper_hash,
    extract_arxiv_version,
)
from main import app
from services import ingestion
from services.ingestion import IngestionCoordinator, should_reindex_paper


# ---------------------------------------------------------------------------
# Helpers & Fixtures
# ---------------------------------------------------------------------------

def _make_paper(aid: str, title: str = "Test Title", abstract: str = "Test Abstract") -> dict:
    return {
        "arxiv_id": aid,
        "title": title,
        "abstract": abstract,
        "authors": ["Alice Smith", "Bob Jones"],
        "published": "2023-01-15",
        "categories": ["cs.AI"],
        "pdf_url": f"https://arxiv.org/pdf/{aid}",
        "entry_url": f"https://arxiv.org/abs/{aid}",
    }


@pytest.fixture
def clean_chroma():
    adapter = ChromaAdapter()
    adapter.reset()
    yield adapter
    adapter.reset()


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


# ===========================================================================
# 1. Version Policy & Change Detection
# ===========================================================================

class TestVersionAndFingerprintPolicy:
    def test_extract_version_explicit(self):
        assert extract_arxiv_version("2301.00001v2") == "v2"
        assert extract_arxiv_version("1706.03762v7") == "v7"

    def test_extract_version_default(self):
        assert extract_arxiv_version("2301.00001") == "v1"
        assert extract_arxiv_version("") == "v1"

    def test_compute_paper_hash_deterministic(self):
        h1 = compute_paper_hash("Title A", "Abstract B")
        h2 = compute_paper_hash("Title A", "Abstract B")
        assert h1 == h2
        assert len(h1) == 16

    def test_compute_paper_hash_case_insensitive(self):
        h1 = compute_paper_hash("Attention", "Abstract")
        h2 = compute_paper_hash("attention", "abstract")
        assert h1 == h2

    def test_should_reindex_missing_record(self):
        candidate = _make_paper("2301.00001v1")
        assert should_reindex_paper(candidate, None) is True

    def test_should_reindex_identical_record_skipped(self):
        candidate = _make_paper("2301.00001v1", title="Title", abstract="Abstract")
        existing = {
            "id": "2301.00001",
            "metadata": {
                "version": "v1",
                "content_hash": compute_paper_hash("Title", "Abstract"),
            },
        }
        assert should_reindex_paper(candidate, existing) is False

    def test_should_reindex_newer_version(self):
        candidate = _make_paper("2301.00001v2", title="Title", abstract="Abstract")
        existing = {
            "id": "2301.00001",
            "metadata": {
                "version": "v1",
                "content_hash": compute_paper_hash("Title", "Abstract"),
            },
        }
        # v2 should trigger re-indexing of the paper
        assert should_reindex_paper(candidate, existing) is True

    def test_should_reindex_modified_content(self):
        candidate = _make_paper("2301.00001v1", title="New Title", abstract="New Abstract")
        existing = {
            "id": "2301.00001",
            "metadata": {
                "version": "v1",
                "content_hash": compute_paper_hash("Old Title", "Old Abstract"),
            },
        }
        assert should_reindex_paper(candidate, existing) is True


# ===========================================================================
# 2. Concurrency Coordinator
# ===========================================================================

class TestConcurrencyCoordinator:
    @pytest.mark.asyncio
    async def test_claims_unoccupied_ids(self):
        coord = IngestionCoordinator()
        claimed, in_flight = await coord.filter_and_claim(["2301.00001", "2301.00002"])
        assert claimed == ["2301.00001", "2301.00002"]
        assert in_flight == []

    @pytest.mark.asyncio
    async def test_blocks_in_flight_duplicates(self):
        coord = IngestionCoordinator()
        # First request claims paper 1
        await coord.filter_and_claim(["2301.00001"])

        # Second concurrent request tries to claim paper 1 and paper 2
        claimed, in_flight = await coord.filter_and_claim(["2301.00001", "2301.00002"])
        assert claimed == ["2301.00002"]
        assert in_flight == ["2301.00001"]

    @pytest.mark.asyncio
    async def test_release_frees_ids(self):
        coord = IngestionCoordinator()
        await coord.filter_and_claim(["2301.00001"])
        await coord.release(["2301.00001"])

        claimed, in_flight = await coord.filter_and_claim(["2301.00001"])
        assert claimed == ["2301.00001"]
        assert in_flight == []


# ===========================================================================
# 3. Ingestion Pipeline & Idempotency
# ===========================================================================

class TestIngestionPipeline:
    @pytest.mark.asyncio
    async def test_idempotent_ingestion_skips_existing(self, clean_chroma):
        coord = IngestionCoordinator()
        papers = [_make_paper("2301.00001v1"), _make_paper("2301.00002v1")]

        with patch("services.embedder.embed_texts", return_value=[[0.1] * 384, [0.2] * 384]) as mock_embed:
            # 1st ingestion pass: both papers are new
            stats1 = await ingestion.ingest_candidates(papers, clean_chroma, coordinator=coord)
            assert stats1.discovered == 2
            assert stats1.newly_indexed == 2
            assert stats1.already_indexed == 0
            assert mock_embed.call_count == 1

            # 2nd ingestion pass with identical papers: re-embedding MUST be skipped!
            stats2 = await ingestion.ingest_candidates(papers, clean_chroma, coordinator=coord)
            assert stats2.discovered == 2
            assert stats2.newly_indexed == 0
            assert stats2.already_indexed == 2
            # embed_texts should NOT have been called again!
            assert mock_embed.call_count == 1

    @pytest.mark.asyncio
    async def test_bounded_batch_size(self, clean_chroma):
        coord = IngestionCoordinator()
        papers = [_make_paper(f"2301.{str(i).zfill(5)}") for i in range(1, 11)]

        with patch("services.embedder.embed_texts", return_value=[[0.1] * 384] * 4) as mock_embed:
            # Enforce max_batch=4
            stats = await ingestion.ingest_candidates(papers, clean_chroma, max_batch=4, coordinator=coord)
            assert stats.newly_indexed == 4
            # embed_texts called with only 4 texts
            assert len(mock_embed.call_args[0][0]) == 4

    @pytest.mark.asyncio
    async def test_embedding_failure_releases_in_flight(self, clean_chroma):
        coord = IngestionCoordinator()
        papers = [_make_paper("2301.00005")]

        with patch("services.embedder.embed_texts", side_effect=RuntimeError("GPU OOM")):
            stats = await ingestion.ingest_candidates(papers, clean_chroma, coordinator=coord)
            assert stats.failed == 1
            assert stats.newly_indexed == 0

        # Verify that in-flight claim was released and paper can be attempted again
        claimed, in_flight = await coord.filter_and_claim(["2301.00005"])
        assert "2301.00005" in claimed


# ===========================================================================
# 4. Search Router Integration with Ingestion
# ===========================================================================

class TestSearchRouteIngestionIntegration:
    @patch("services.arxiv_client.search_papers")
    @patch("services.embedder.embed_query")
    @patch("services.embedder.embed_texts")
    def test_search_avoids_re_embedding_cached_papers(
        self,
        mock_embed_texts,
        mock_embed_query,
        mock_search,
        client,
    ):
        mock_embed_query.return_value = [0.1] * 384
        mock_embed_texts.return_value = [[0.1] * 384]

        p1 = _make_paper("2301.00001v1", title="Transformers")
        mock_search.return_value = [p1]

        # First search: newly indexes p1
        resp1 = client.post("/api/search", json={"query": "transformers"})
        assert resp1.status_code == 200
        data1 = resp1.json()
        assert data1["total"] == 1
        assert data1["ingestion"]["newly_indexed"] == 1
        assert data1["ingestion"]["already_indexed"] == 0
        assert mock_embed_texts.call_count == 1

        # Second search: p1 is already indexed, embedding avoided!
        resp2 = client.post("/api/search", json={"query": "transformers"})
        assert resp2.status_code == 200
        data2 = resp2.json()
        assert data2["total"] == 1
        assert data2["ingestion"]["already_indexed"] == 1
        assert data2["ingestion"]["newly_indexed"] == 0
        # embed_texts was NOT called again
        assert mock_embed_texts.call_count == 1


# ===========================================================================
# 5. Ingest Router Endpoints (/api/ingest)
# ===========================================================================

class TestIngestRouter:
    def test_get_ingest_status(self, client):
        response = client.get("/api/ingest/status")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ready"
        assert "backend" in data
        assert "total_indexed_papers" in data

    def test_post_ingest_empty_payload_fails(self, client):
        response = client.post("/api/ingest", json={})
        assert response.status_code == 422
        assert "Either 'query' or 'arxiv_ids'" in response.json()["detail"]

    @patch("services.arxiv_client.search_papers")
    @patch("services.embedder.embed_texts")
    def test_post_ingest_by_query_success(self, mock_embed, mock_search, client):
        mock_embed.return_value = [[0.1] * 384]
        mock_search.return_value = [_make_paper("2301.00010v1")]

        response = client.post("/api/ingest", json={"query": "deep learning", "max_papers": 5})
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "completed"
        assert "stats" in data
        assert data["stats"]["discovered"] == 1
        assert "total_indexed_papers" in data
