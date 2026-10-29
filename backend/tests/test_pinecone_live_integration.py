"""
Optional live integration test for Pinecone.

Only executes if PINECONE_API_KEY is configured in the environment.
Exercises live Pinecone index connection, deduplication, and score contracts.
"""

from __future__ import annotations

import asyncio
import os
import pytest

from db.pinecone_adapter import PineconeAdapter
from services import ingestion


@pytest.mark.skipif(
    not os.getenv("PINECONE_API_KEY"),
    reason="PINECONE_API_KEY environment variable not set; skipping live Pinecone test",
)
class TestPineconeLiveIntegration:
    @pytest.fixture
    def live_adapter(self):
        adapter = PineconeAdapter()
        yield adapter

    @pytest.mark.asyncio
    async def test_live_ingest_and_idempotency(self, live_adapter):
        test_paper = {
            "arxiv_id": "9999.00001v1",
            "title": "Live Integration Test Paper",
            "abstract": "Verifying Pinecone live index operations and deduplication.",
            "authors": ["Test Bot"],
            "published": "2024-01-01",
            "categories": ["cs.AI"],
            "pdf_url": "https://arxiv.org/pdf/9999.00001",
            "entry_url": "https://arxiv.org/abs/9999.00001",
        }

        # 1. Fetch records before upsert - should be empty
        before = live_adapter.fetch_records(["9999.00001"])
        assert "9999.00001" not in before

        # 2. Ingest candidate paper
        stats1 = await ingestion.ingest_candidates([test_paper], live_adapter)
        assert stats1.newly_indexed == 1
        assert stats1.already_indexed == 0

        # 3. Poll for eventual consistency in serverless index
        after = {}
        for _ in range(6):
            after = live_adapter.fetch_records(["9999.00001"])
            if "9999.00001" in after:
                break
            await asyncio.sleep(1.0)

        assert "9999.00001" in after
        meta = after["9999.00001"]["metadata"]
        assert meta["title"] == "Live Integration Test Paper"
        assert meta["version"] == "v1"
        assert "content_hash" in meta

        # 4. Ingest again - must be skipped as already indexed!
        stats2 = await ingestion.ingest_candidates([test_paper], live_adapter)
        assert stats2.already_indexed == 1
        assert stats2.newly_indexed == 0

        # 5. Query for the paper
        query_vec = [0.05] * 384
        matches = live_adapter.query(query_vec, n_results=5, filter_ids=["9999.00001"])
        assert len(matches) == 1
        assert matches[0]["id"] == "9999.00001"

        # 6. Cleanup test vector
        try:
            live_adapter._index.delete(ids=["9999.00001"])
        except Exception:
            pass
