from __future__ import annotations

import contextvars
import logging
import math
import os
import re
import threading
import time
import uuid
from collections import defaultdict, deque
from typing import Any

# Context variable holding the trace/request identifier for the current async task
_request_id_ctx: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="")

# -----------------------------------------------------------------------------
# Request ID Helpers
# -----------------------------------------------------------------------------

def generate_request_id() -> str:
    """Generate a clean, compact, trace-friendly request identifier."""
    return f"req-{uuid.uuid4().hex[:12]}"


def get_request_id() -> str:
    """Return the active request ID in the current execution context, or empty string."""
    return _request_id_ctx.get()


def set_request_id(request_id: str) -> None:
    """Set the active request ID for the current execution context."""
    _request_id_ctx.set(request_id)


# -----------------------------------------------------------------------------
# Secret Redaction
# -----------------------------------------------------------------------------

# Regular expressions matching sensitive keys and tokens
_SECRET_PATTERNS = [
    # Groq API keys (gsk_...)
    (re.compile(r"gsk_[A-Za-z0-9_-]{12,}", re.IGNORECASE), "gsk_[REDACTED]"),
    # Pinecone API keys (pcsk_...)
    (re.compile(r"pcsk_[A-Za-z0-9_-]{12,}", re.IGNORECASE), "pcsk_[REDACTED]"),
    # Bearer authorization tokens
    (re.compile(r"(Bearer\s+)[A-Za-z0-9._\-]{12,}", re.IGNORECASE), r"\1[REDACTED_TOKEN]"),
    # Generic key/secret assignments (e.g., api_key=..., secret="...")
    (
        re.compile(
            r"(?i)\b(api[_-]?key|secret|password|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*['\"]?([A-Za-z0-9_\-\.]{8,})['\"]?"
        ),
        r"\1=[REDACTED]",
    ),
]


def redact_secrets(text: str) -> str:
    """Scrub known API keys and sensitive tokens from arbitrary log text."""
    if not text:
        return text
    redacted = text
    for pattern, replacement in _SECRET_PATTERNS:
        redacted = pattern.sub(replacement, redacted)
    return redacted


class SecretRedactionFilter(logging.Filter):
    """
    Standard logging.Filter that intercepts every log record and redacts
    API keys, credentials, and authorization tokens before writing to stderr/stdout.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact_secrets(record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = {k: redact_secrets(str(v)) for k, v in record.args.items()}
            elif isinstance(record.args, tuple):
                record.args = tuple(
                    redact_secrets(str(arg)) if isinstance(arg, str) else arg
                    for arg in record.args
                )
        return True


class RequestIdFormatter(logging.Formatter):
    """
    Formatter that injects the active request ID into the log output when available.
    """

    def format(self, record: logging.LogRecord) -> str:
        req_id = get_request_id()
        prefix = f"[{req_id}] " if req_id else ""
        formatted = super().format(record)
        if req_id and not formatted.startswith(f"[{req_id}]"):
            # If the format doesn't natively include %(request_id)s, prefix message
            return f"{prefix}{formatted}"
        return formatted


# -----------------------------------------------------------------------------
# In-Memory Metrics Registry
# -----------------------------------------------------------------------------

_MAX_LATENCY_OBSERVATIONS = 300


class MetricsRegistry:
    """
    Lightweight, thread-safe in-memory operational metrics collector.

    Memory overhead is strictly bounded:
    - Counters: simple integer dictionary (~1KB).
    - Latencies: fixed-size rolling deque of max 300 observations per stage (<50KB total).
    - No external monitoring platforms or databases required.

    IMPORTANT: In-memory metrics are transient. They reset whenever Render's
    free-tier service sleeps or restarts.
    """

    def __init__(self, max_observations: int = _MAX_LATENCY_OBSERVATIONS) -> None:
        self._max_obs = max_observations
        self._start_time = time.time()
        self._lock = threading.Lock()
        self._counters: dict[str, int] = defaultdict(int)
        self._latencies: dict[str, deque[float]] = defaultdict(lambda: deque(maxlen=self._max_obs))

    def reset(self) -> None:
        """Reset all counters and observations (useful for testing)."""
        with self._lock:
            self._start_time = time.time()
            self._counters.clear()
            self._latencies.clear()

    # -- Counter Methods --

    def increment(self, metric_name: str, count: int = 1) -> None:
        """Increment a counter by the specified amount."""
        with self._lock:
            self._counters[metric_name] += count

    def record_request(self, method: str, status_code: int) -> None:
        """Record an incoming HTTP request."""
        with self._lock:
            self._counters["requests_total"] += 1
            self._counters[f"http_{status_code}"] += 1
            if status_code >= 400:
                self._counters["errors_total"] += 1

    def record_empty_result(self) -> None:
        """Record a search or retrieval request that returned 0 results."""
        self.increment("empty_results_total")

    def record_cache_hit(self, cache_name: str = "generic") -> None:
        """Record a cache hit."""
        with self._lock:
            self._counters["cache_hits_total"] += 1
            self._counters[f"cache_hit_{cache_name}"] += 1

    def record_cache_miss(self, cache_name: str = "generic") -> None:
        """Record a cache miss."""
        with self._lock:
            self._counters["cache_misses_total"] += 1
            self._counters[f"cache_miss_{cache_name}"] += 1

    def record_retrieval_failure(self, stage: str = "retrieval") -> None:
        """Record a retrieval failure (e.g. arXiv 503, vector search error)."""
        with self._lock:
            self._counters["retrieval_failures_total"] += 1
            self._counters[f"retrieval_failure_{stage}"] += 1

    def record_groq_failure(self, error_type: str = "general") -> None:
        """Record a Groq LLM failure (e.g. rate limit, auth, invalid output)."""
        with self._lock:
            self._counters["groq_failures_total"] += 1
            self._counters[f"groq_failure_{error_type}"] += 1

    def record_streaming_interruption(self) -> None:
        """Record a streaming response interrupted by client disconnection."""
        self.increment("streaming_interruptions_total")

    # -- Latency Methods --

    def record_latency(self, stage: str, duration_ms: float) -> None:
        """Record an elapsed duration measurement in milliseconds for a pipeline stage."""
        if duration_ms < 0:
            duration_ms = 0.0
        with self._lock:
            self._latencies[stage].append(duration_ms)

    def get_summary(self) -> dict[str, Any]:
        """
        Compute summary statistics (min, mean, p50, p95, max) for each recorded stage.
        """
        with self._lock:
            uptime = round(time.time() - self._start_time, 2)
            counters_copy = dict(self._counters)
            latencies_copy = {stage: list(vals) for stage, vals in self._latencies.items()}

        latency_summary: dict[str, Any] = {}
        for stage, observations in latencies_copy.items():
            if not observations:
                continue
            sorted_obs = sorted(observations)
            n = len(sorted_obs)
            min_val = round(sorted_obs[0], 2)
            max_val = round(sorted_obs[-1], 2)
            mean_val = round(sum(sorted_obs) / n, 2)

            # Quantile calculation
            p50_idx = int(math.ceil(0.50 * n)) - 1
            p95_idx = int(math.ceil(0.95 * n)) - 1
            p50_val = round(sorted_obs[max(0, p50_idx)], 2)
            p95_val = round(sorted_obs[max(0, min(n - 1, p95_idx))], 2)

            latency_summary[stage] = {
                "count": n,
                "min_ms": min_val,
                "mean_ms": mean_val,
                "p50_ms": p50_val,
                "p95_ms": p95_val,
                "max_ms": max_val,
            }

        return {
            "service": "scholytics-backend",
            "uptime_seconds": uptime,
            "storage": "in_memory_transient",
            "warning": "Metrics reset when Render free-tier service restarts or sleeps.",
            "counters": counters_copy,
            "latencies": latency_summary,
        }


# Global metrics singleton
metrics = MetricsRegistry()
