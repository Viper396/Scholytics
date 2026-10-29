from __future__ import annotations

import logging
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from main import app
from services.metrics import (
    SecretRedactionFilter,
    generate_request_id,
    metrics,
    redact_secrets,
)


@pytest.fixture(autouse=True)
def reset_global_metrics():
    """Ensure clean metric state before and after each test."""
    metrics.reset()
    yield
    metrics.reset()


# -----------------------------------------------------------------------------
# 1. Secret Redaction Tests
# -----------------------------------------------------------------------------

def test_secret_redaction_regex_patterns():
    # Groq API key
    groq_sample = "Calling Groq with key gsk_abc1234567890XYZ_secret"
    redacted = redact_secrets(groq_sample)
    assert "gsk_abc1234567890XYZ_secret" not in redacted
    assert "gsk_[REDACTED]" in redacted

    # Pinecone API key
    pinecone_sample = "Connecting to Pinecone pcsk_9876543210zyx_secret"
    redacted = redact_secrets(pinecone_sample)
    assert "pcsk_9876543210zyx_secret" not in redacted
    assert "pcsk_[REDACTED]" in redacted

    # Bearer auth token
    bearer_sample = "Authorization: Bearer my_super_secret_jwt_token_12345"
    redacted = redact_secrets(bearer_sample)
    assert "my_super_secret_jwt_token_12345" not in redacted
    assert "Bearer [REDACTED_TOKEN]" in redacted

    # Generic api_key assignment
    assignment_sample = "Config params: api_key=topsecretvalue12345 and secret='hiddenpassword123'"
    redacted = redact_secrets(assignment_sample)
    assert "topsecretvalue12345" not in redacted
    assert "hiddenpassword123" not in redacted


def test_secret_redaction_logging_filter():
    filter_instance = SecretRedactionFilter()
    record = logging.LogRecord(
        name="test_logger",
        level=logging.INFO,
        pathname="test.py",
        lineno=10,
        msg="Authenticated user with token Bearer secret_token_xyz_123456",
        args=(),
        exc_info=None,
    )

    passed = filter_instance.filter(record)
    assert passed is True
    assert "secret_token_xyz_123456" not in record.msg
    assert "Bearer [REDACTED_TOKEN]" in record.msg


def test_secret_redaction_with_args():
    filter_instance = SecretRedactionFilter()
    record = logging.LogRecord(
        name="test_logger",
        level=logging.ERROR,
        pathname="test.py",
        lineno=20,
        msg="Failed with key %s and url %s",
        args=("gsk_groqsecretkey12345", "https://api.groq.com"),
        exc_info=None,
    )

    filter_instance.filter(record)
    assert "gsk_groqsecretkey12345" not in record.args[0]
    assert "gsk_[REDACTED]" in record.args[0]


# -----------------------------------------------------------------------------
# 2. Request Correlation & ID Propagation Tests
# -----------------------------------------------------------------------------

def test_request_id_generation():
    req_id = generate_request_id()
    assert req_id.startswith("req-")
    assert len(req_id) >= 10


def test_request_id_in_response_header():
    client = TestClient(app)
    # 1. Custom incoming request ID is preserved
    custom_id = "trace-custom-abc-123"
    response = client.get("/health/live", headers={"x-request-id": custom_id})
    assert response.status_code == 200
    assert response.headers.get("X-Request-ID") == custom_id
    assert "X-Response-Time-Ms" in response.headers

    # 2. Generated request ID when none provided
    response_auto = client.get("/health/live")
    assert response_auto.status_code == 200
    auto_id = response_auto.headers.get("X-Request-ID")
    assert auto_id is not None
    assert auto_id.startswith("req-")


# -----------------------------------------------------------------------------
# 3. Health & Readiness Endpoint Distinction
# -----------------------------------------------------------------------------

def test_liveness_check_independent_of_dependencies():
    client = TestClient(app)
    response = client.get("/health/live")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "alive"
    assert "uptime_seconds" in data
    assert data["version"] == "1.0.0"


def test_readiness_check_distinguishes_dependencies():
    client = TestClient(app)
    response = client.get("/health/ready")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "vector_store" in data
    assert "groq_configured" in data
    assert "embedder" in data
    assert "reranker" in data


# -----------------------------------------------------------------------------
# 4. Metrics Registry Unit Tests
# -----------------------------------------------------------------------------

def test_metrics_registry_quantiles():
    # Record 100 observations: 1.0 to 100.0 ms
    for i in range(1, 101):
        metrics.record_latency("test_stage_ms", float(i))

    summary = metrics.get_summary()
    stage_stats = summary["latencies"]["test_stage_ms"]

    assert stage_stats["count"] == 100
    assert stage_stats["min_ms"] == 1.0
    assert stage_stats["max_ms"] == 100.0
    assert stage_stats["p50_ms"] == 50.0
    assert stage_stats["p95_ms"] == 95.0
    assert stage_stats["mean_ms"] == 50.5


def test_metrics_registry_rolling_bound():
    # Max observation buffer is 300
    for i in range(400):
        metrics.record_latency("bounded_stage_ms", float(i))

    summary = metrics.get_summary()
    stage_stats = summary["latencies"]["bounded_stage_ms"]
    assert stage_stats["count"] == 300
    # Oldest 100 observations evicted
    assert stage_stats["min_ms"] == 100.0
    assert stage_stats["max_ms"] == 399.0


def test_metrics_counters_and_failures():
    metrics.record_request("GET", 200)
    metrics.record_request("POST", 500)
    metrics.record_empty_result()
    metrics.record_retrieval_failure("arxiv")
    metrics.record_groq_failure("ratelimit")
    metrics.record_streaming_interruption()
    metrics.record_cache_hit("test_cache")
    metrics.record_cache_miss("test_cache")

    summary = metrics.get_summary()
    counters = summary["counters"]

    assert counters["requests_total"] == 2
    assert counters["http_200"] == 1
    assert counters["http_500"] == 1
    assert counters["errors_total"] == 1
    assert counters["empty_results_total"] == 1
    assert counters["retrieval_failures_total"] == 1
    assert counters["retrieval_failure_arxiv"] == 1
    assert counters["groq_failures_total"] == 1
    assert counters["groq_failure_ratelimit"] == 1
    assert counters["streaming_interruptions_total"] == 1
    assert counters["cache_hits_total"] == 1
    assert counters["cache_misses_total"] == 1


# -----------------------------------------------------------------------------
# 5. Integration Endpoints: /api/metrics and /api/metrics/reset
# -----------------------------------------------------------------------------

def test_metrics_api_endpoint():
    client = TestClient(app)
    client.get("/health/live")

    res = client.get("/api/metrics")
    assert res.status_code == 200
    data = res.json()
    assert data["storage"] == "in_memory_transient"
    assert "warning" in data
    assert "uptime_seconds" in data
    assert "counters" in data
    assert "latencies" in data

    # Test reset
    reset_res = client.post("/api/metrics/reset")
    assert reset_res.status_code == 200
    assert reset_res.json() == {"status": "reset"}

    # Post-reset counters should be cleared
    res_after = client.get("/api/metrics")
    assert res_after.json()["counters"].get("empty_results_total") is None


# -----------------------------------------------------------------------------
# 6. Streaming Interruption Integration Test
# -----------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_synthesis_stream_interruption_recording():
    from routers.search import SearchSynthesizeRequest, synthesize_search

    def mock_generator(*args, **kwargs):
        yield "Token 1 "
        yield "Token 2 "
        yield "Token 3 "

    with patch("services.summarizer.generate_search_summary", side_effect=mock_generator):
        payload = SearchSynthesizeRequest(
            query="transformer attention",
            arxiv_ids=["2301.00001"],
            papers=[
                {
                    "arxiv_id": "2301.00001",
                    "title": "Attention Is All You Need",
                    "abstract": "The dominant sequence transduction models...",
                }
            ],
        )

        initial_interruptions = metrics.get_summary()["counters"].get("streaming_interruptions_total", 0)

        response = await synthesize_search(payload)
        gen = response.body_iterator
        first_event = await gen.__anext__()
        assert "event: sources" in first_event

        # Simulate client closing stream abruptly
        try:
            await gen.aclose()
        except GeneratorExit:
            pass

        after_interruptions = metrics.get_summary()["counters"].get("streaming_interruptions_total", 0)
        assert after_interruptions >= initial_interruptions + 1
