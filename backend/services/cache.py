"""
Bounded in-memory caching and single-flight request coalescing for Scholytics.

Engineered specifically for Render's 512MB RAM free-tier environment:
- Zero external infrastructure (no Redis or paid cloud dependencies).
- Bounded memory footprint (<5 MB total across all caches, <1% of RAM).
- Strict Least Recently Used (LRU) eviction when maxsize is reached.
- Explicit per-cache Time-To-Live (TTL) expiration.
- Single-flight lock/future coordination preventing thundering herd (stampede).
- Complete correctness when empty or on process restart (disposable caches).
- Zero caching of errors, exceptions, or degraded fallback states.
- Exact composite cache keys incorporating query, filters, limits, and backend config.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import sys
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Coroutine, Generic, TypeVar

logger = logging.getLogger(__name__)

K = TypeVar("K")
V = TypeVar("V")


def is_cache_enabled() -> bool:
    """Master toggle for in-memory caching."""
    return os.getenv("ENABLE_CACHE", "true").strip().lower() in ("true", "1", "yes")


class BoundedLRU(Generic[K, V]):
    """
    Thread-safe, bounded Least Recently Used (LRU) cache with per-entry TTL.

    Guarantees:
    - Never exceeds `maxsize` entries.
    - Evicts the least recently accessed item when capacity is reached.
    - Drops entries older than `ttl` seconds upon access.
    - Thread-safe for multi-threaded executor pools (e.g. asyncio.to_thread).
    """

    def __init__(self, name: str, maxsize: int = 128, default_ttl: float | None = 600.0) -> None:
        if maxsize < 1:
            raise ValueError(f"maxsize must be at least 1, got {maxsize}")
        self.name = name
        self.maxsize = maxsize
        self.default_ttl = default_ttl

        self._store: OrderedDict[K, tuple[V, float, float]] = OrderedDict()
        self._lock = threading.Lock()

        # Telemetry counters
        self._hits = 0
        self._misses = 0
        self._evictions = 0
        self._expirations = 0

    def get(self, key: K) -> V | None:
        if not is_cache_enabled():
            return None

        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                self._misses += 1
                return None

            val, expires_at, _ = entry
            now = time.time()
            if expires_at is not None and now > expires_at:
                # Expired — remove and record miss
                self._store.pop(key, None)
                self._expirations += 1
                self._misses += 1
                return None

            # Hit — mark as most recently used
            self._store.move_to_end(key, last=True)
            self._hits += 1
            return val

    def set(self, key: K, value: V, ttl: float | None = None) -> None:
        if not is_cache_enabled():
            return

        effective_ttl = ttl if ttl is not None else self.default_ttl
        now = time.time()
        expires_at = (now + effective_ttl) if effective_ttl is not None else None

        with self._lock:
            if key in self._store:
                self._store[key] = (value, expires_at, now)
                self._store.move_to_end(key, last=True)
                return

            # Check capacity bound and evict oldest if necessary
            while len(self._store) >= self.maxsize:
                self._store.popitem(last=False)
                self._evictions += 1

            self._store[key] = (value, expires_at, now)

    def delete(self, key: K) -> bool:
        """Invalidate a specific key."""
        with self._lock:
            return self._store.pop(key, None) is not None

    def clear(self) -> None:
        """Invalidate all cached entries."""
        with self._lock:
            self._store.clear()

    def stats(self) -> dict[str, Any]:
        """Return operational cache telemetry."""
        with self._lock:
            total_lookups = self._hits + self._misses
            hit_ratio = (self._hits / total_lookups) if total_lookups > 0 else 0.0
            return {
                "name": self.name,
                "size": len(self._store),
                "maxsize": self.maxsize,
                "hits": self._hits,
                "misses": self._misses,
                "hit_ratio": round(hit_ratio, 4),
                "evictions": self._evictions,
                "expirations": self._expirations,
                "estimated_memory_bytes": self.estimate_memory_bytes(),
            }

    def estimate_memory_bytes(self) -> int:
        """Rough estimation of memory consumed by stored items."""
        total = sys.getsizeof(self._store)
        for k, (v, _, _) in self._store.items():
            total += sys.getsizeof(k)
            total += sys.getsizeof(v)
            if isinstance(v, (str, bytes)):
                total += len(v)
            elif isinstance(v, (list, tuple)):
                total += len(v) * 8
            elif isinstance(v, dict):
                total += len(v) * 64
        return total


class AsyncSingleFlight:
    """
    Coalesces concurrent asynchronous requests for the same key.

    If 10 concurrent requests arrive for the exact same key, only ONE executes
    the underlying async function. The other 9 wait for the result of the first,
    preventing duplicate network calls, embeddings, or upstream API hits.
    """

    def __init__(self) -> None:
        self._in_flight: dict[str, asyncio.Future] = {}
        self._lock = asyncio.Lock()

    async def execute(self, key: str, fn: Callable[[], Coroutine[Any, Any, V]]) -> V:
        async with self._lock:
            if key in self._in_flight:
                future = self._in_flight[key]
                # Await the ongoing task outside this lock
                should_execute = False
            else:
                loop = asyncio.get_running_loop()
                future = loop.create_future()
                self._in_flight[key] = future
                should_execute = True

        if not should_execute:
            return await future

        try:
            result = await fn()
            if not future.done():
                future.set_result(result)
            return result
        except BaseException as exc:
            if not future.done():
                future.set_exception(exc)
                # Avoid "Future exception was never retrieved" warning when single caller
                try:
                    future.exception()
                except BaseException:
                    pass
            raise
        finally:
            async with self._lock:
                self._in_flight.pop(key, None)


class SyncSingleFlight:
    """
    Coalesces concurrent synchronous / threaded requests for the same key.
    Useful for operations run via asyncio.to_thread (e.g. arXiv calls).
    """

    def __init__(self) -> None:
        self._locks: dict[str, threading.Lock] = {}
        self._registry_lock = threading.Lock()

    def get_lock(self, key: str) -> threading.Lock:
        with self._registry_lock:
            if key not in self._locks:
                self._locks[key] = threading.Lock()
            return self._locks[key]

    def cleanup(self, key: str) -> None:
        with self._registry_lock:
            # Only remove if not currently acquired
            lock = self._locks.get(key)
            if lock and not lock.locked():
                self._locks.pop(key, None)


# -----------------------------------------------------------------------------
# Cache Key Builders
# -----------------------------------------------------------------------------

def build_search_cache_key(
    query: str,
    max_results: int,
    filters: dict[str, Any] | None = None,
    vector_backend: str | None = None,
    enable_reranker: bool = False,
) -> str:
    """
    Construct a deterministic, collision-resistant cache key for a search request.
    Incorporates query text, filters (date, categories), result count, and backend settings.
    """
    clean_query = query.strip().lower()
    date_from = ""
    categories: list[str] = []

    if filters:
        date_from = str(filters.get("date_from") or "").strip()
        raw_cats = filters.get("categories") or []
        if isinstance(raw_cats, list):
            categories = sorted(str(c).strip().lower() for c in raw_cats if str(c).strip())

    vb_str = str(vector_backend) if isinstance(vector_backend, str) else "chroma"

    key_payload = {
        "q": clean_query,
        "n": max_results,
        "d": date_from,
        "c": categories,
        "vb": vb_str.lower(),
        "rr": bool(enable_reranker),
    }
    encoded = json.dumps(key_payload, sort_keys=True)
    digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:24]
    return f"search:{digest}"


def build_paper_cache_key(arxiv_id: str) -> str:
    """Canonicalize arXiv ID for paper metadata caching."""
    clean = arxiv_id.strip()
    return f"paper:{clean}"


def build_query_embedding_cache_key(query: str) -> str:
    """Normalize query for embedding vector caching."""
    clean = " ".join(query.strip().lower().split())
    digest = hashlib.sha256(clean.encode("utf-8")).hexdigest()[:20]
    return f"qemb:{digest}"


def build_summary_cache_key(arxiv_id: str, title: str, abstract: str) -> str:
    """
    Construct cache key for paper summary.
    Includes content hash so edits or new versions automatically invalidate old summaries.
    """
    content = f"{title.strip()}\n{abstract.strip()}"
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]
    return f"summary:{arxiv_id.strip()}:{content_hash}"


def build_compare_cache_key(papers: list[dict[str, Any]], query: str | None = None) -> str:
    """
    Construct cache key for multi-paper comparative analysis.
    Incorporates canonical IDs, content hashes (to prevent stale metadata across versions),
    and normalized query context.
    """
    sorted_items = []
    for p in sorted(papers, key=lambda x: str(x.get("arxiv_id", ""))):
        aid = str(p.get("arxiv_id", "")).strip()
        title = str(p.get("title", "")).strip()
        abstract = str(p.get("abstract", "")).strip()
        content = f"{title}\n{abstract}".encode("utf-8")
        h = hashlib.sha256(content).hexdigest()[:12]
        sorted_items.append({"id": aid, "h": h})

    q_part = (query or "").strip().lower()
    encoded = json.dumps({"papers": sorted_items, "q": q_part}, sort_keys=True)
    digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:20]
    return f"compare:{digest}"


# -----------------------------------------------------------------------------
# Global Bounded Cache Instances (Strictly budgeted for 512MB RAM)
# -----------------------------------------------------------------------------

# 1. Raw arXiv search results (128 entries, TTL 15 mins) ~500 KB
arxiv_search_cache: BoundedLRU[str, list[dict[str, Any]]] = BoundedLRU(
    name="arxiv_search",
    maxsize=128,
    default_ttl=900.0,
)

# 2. Individual arXiv paper metadata (512 entries, TTL 12 hours) ~1.5 MB
arxiv_paper_cache: BoundedLRU[str, dict[str, Any]] = BoundedLRU(
    name="arxiv_paper",
    maxsize=512,
    default_ttl=43200.0,
)

# 3. Query embedding vectors (256 entries, TTL 1 hour) ~800 KB
query_embedding_cache: BoundedLRU[str, list[float]] = BoundedLRU(
    name="query_embedding",
    maxsize=256,
    default_ttl=3600.0,
)

# 4. Search endpoint fully ranked responses (64 entries, TTL 5 mins) ~300 KB
search_response_cache: BoundedLRU[str, dict[str, Any]] = BoundedLRU(
    name="search_response",
    maxsize=64,
    default_ttl=300.0,
)

# 5. Paper LLM summaries (128 entries, TTL 24 hours) ~300 KB
paper_summary_cache: BoundedLRU[str, str] = BoundedLRU(
    name="paper_summary",
    maxsize=128,
    default_ttl=86400.0,
)

# 6. Structured paper comparisons (64 entries, TTL 1 hour) ~200 KB
paper_comparison_cache: BoundedLRU[str, dict[str, Any]] = BoundedLRU(
    name="paper_comparison",
    maxsize=64,
    default_ttl=3600.0,
)

# Single-flight coordinators
async_single_flight = AsyncSingleFlight()
sync_single_flight = SyncSingleFlight()


def get_all_cache_stats() -> dict[str, Any]:
    """Diagnostic telemetry across all bounded in-memory caches."""
    caches = [
        arxiv_search_cache,
        arxiv_paper_cache,
        query_embedding_cache,
        search_response_cache,
        paper_summary_cache,
        paper_comparison_cache,
    ]
    total_entries = sum(c.stats()["size"] for c in caches)
    total_bytes = sum(c.stats()["estimated_memory_bytes"] for c in caches)
    return {
        "enabled": is_cache_enabled(),
        "total_entries": total_entries,
        "total_estimated_memory_kb": round(total_bytes / 1024, 2),
        "caches": {c.name: c.stats() for c in caches},
    }


def clear_all_caches() -> None:
    """Clear all in-memory caches (for testing, memory reclamation, or invalidation)."""
    arxiv_search_cache.clear()
    arxiv_paper_cache.clear()
    query_embedding_cache.clear()
    search_response_cache.clear()
    paper_summary_cache.clear()
    paper_comparison_cache.clear()
