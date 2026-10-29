"""
CLI script for initial corpus seeding and incremental index ingestion.

Allows operators to populate or refresh the persistent Pinecone/Chroma vector index
without blocking application startup or overloading free-tier resources.

Features:
- Discovers foundational papers for key topics or categories.
- Respects arXiv etiquette with configurable request delays (default: 3 seconds).
- Skips already-indexed papers via canonical arXiv ID and content-hash checking.
- Embeds only new papers in bounded batches.
- Reports detailed telemetry (discovered, skipped, newly indexed, total count).

Usage:
    # Activate venv first:
    python -m scripts.ingest_corpus --topics "transformer attention" "diffusion models" --max-per-topic 10
    python -m scripts.ingest_corpus --status
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import _build_vector_store
from services import arxiv_client, ingestion

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("ingest_corpus")

# Default foundational topics across modern AI / ML research
DEFAULT_TOPICS = [
    "deep learning transformers",
    "retrieval augmented generation",
    "diffusion generative models",
    "reinforcement learning from human feedback",
    "graph neural networks",
]


async def run_ingestion(
    topics: list[str],
    max_per_topic: int,
    delay_between_topics: float,
) -> None:
    logger.info("Initializing vector store adapter...")
    vector_store = _build_vector_store()
    initial_count = vector_store.count()
    backend_name = vector_store.__class__.__name__
    logger.info("Connected to %s. Current indexed papers: %d", backend_name, initial_count)

    total_discovered = 0
    total_already_indexed = 0
    total_newly_indexed = 0
    total_failed = 0

    for idx, topic in enumerate(topics, start=1):
        logger.info("[%d/%d] Querying arXiv for topic: %r (max %d papers)...", idx, len(topics), topic, max_per_topic)
        try:
            papers = await asyncio.to_thread(
                arxiv_client.search_papers,
                query=topic,
                max_results=max_per_topic,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("arXiv search failed for topic %r: %s", topic, exc)
            continue

        if not papers:
            logger.info("No papers returned by arXiv for topic %r", topic)
            continue

        logger.info("Discovered %d candidate papers. Checking vector store...", len(papers))
        stats = await ingestion.ingest_candidates(
            papers=papers,
            vector_store=vector_store,
            max_batch=max_per_topic,
        )

        total_discovered += stats.discovered
        total_already_indexed += stats.already_indexed
        total_newly_indexed += stats.newly_indexed
        total_failed += stats.failed

        logger.info(
            "Topic results: %d already indexed (skipped), %d newly embedded & upserted, %d failed",
            stats.already_indexed,
            stats.newly_indexed,
            stats.failed,
        )

        # Respect arXiv API etiquette delay before next query
        if idx < len(topics) and delay_between_topics > 0:
            logger.info("Waiting %.1fs before next arXiv request...", delay_between_topics)
            await asyncio.sleep(delay_between_topics)

    final_count = vector_store.count()
    logger.info("=" * 60)
    logger.info("Ingestion Summary for %s:", backend_name)
    logger.info("  Topics processed:        %d", len(topics))
    logger.info("  Total discovered:        %d", total_discovered)
    logger.info("  Already indexed:         %d (embeddings avoided!)", total_already_indexed)
    logger.info("  Newly indexed:           %d", total_newly_indexed)
    logger.info("  Failed:                  %d", total_failed)
    logger.info("  Initial index count:     %d", initial_count)
    logger.info("  Final index count:       %d (+%d)", final_count, final_count - initial_count)
    logger.info("=" * 60)


def show_status() -> None:
    vector_store = _build_vector_store()
    count = vector_store.count()
    backend_name = vector_store.__class__.__name__
    print(f"\nVector Store Status:")
    print(f"  Backend:         {backend_name}")
    print(f"  Total Vectors:   {count}")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="Scholytics Corpus Ingestion & Seeding CLI")
    parser.add_argument(
        "--status",
        action="store_true",
        help="Display current vector store index status and vector count.",
    )
    parser.add_argument(
        "--topics",
        nargs="+",
        default=DEFAULT_TOPICS,
        help="Research topics or queries to discover on arXiv and ingest.",
    )
    parser.add_argument(
        "--max-per-topic",
        type=int,
        default=10,
        help="Maximum papers to discover per topic (default: 10, max: 25).",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=3.0,
        help="Polite sleep delay in seconds between consecutive arXiv API calls (default: 3.0s).",
    )

    args = parser.parse_args()

    if args.status:
        show_status()
        return

    max_papers = max(1, min(25, args.max_per_topic))
    asyncio.run(
        run_ingestion(
            topics=args.topics,
            max_per_topic=max_papers,
            delay_between_topics=max(0.0, args.delay),
        )
    )


if __name__ == "__main__":
    main()
