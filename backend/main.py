import logging
import os
import re
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from routers.graph import router as graph_router
from routers.ingest import router as ingest_router
from routers.papers import router as papers_router
from routers.search import router as search_router
from services.metrics import (
	SecretRedactionFilter,
	generate_request_id,
	metrics,
	set_request_id,
)

# Configure logging with secret redaction
logging.basicConfig(
	level=logging.INFO,
	format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
root_logger = logging.getLogger()
redaction_filter = SecretRedactionFilter()
root_logger.addFilter(redaction_filter)
for handler in root_logger.handlers:
	handler.addFilter(redaction_filter)

logger = logging.getLogger(__name__)

_SAFE_REQ_ID_PATTERN = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")


def is_production() -> bool:
	"""Check if running in a production deployment (Render, production environment, etc.)."""
	env = os.getenv("ENVIRONMENT", os.getenv("ENV", "")).strip().lower()
	return env in ("production", "prod") or os.getenv("RENDER", "").strip().lower() == "true"


def get_allowed_origins() -> list[str]:
	raw_origins = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000").strip()
	if not raw_origins:
		logger.warning(
			"FRONTEND_ORIGIN is not set. CORS will reject cross-origin requests. "
			"Set FRONTEND_ORIGIN to your deployed frontend URL in production."
		)
		return []
	origins: set[str] = set()
	for part in raw_origins.split(","):
		cleaned = part.strip()
		if cleaned:
			origins.add(cleaned)
			origins.add(cleaned.rstrip("/"))
	return sorted(origins)


def _build_vector_store():
	"""
	Instantiate and return the configured vector-store adapter.

	The backend is selected by the ``VECTOR_STORE_BACKEND`` environment variable:

	* ``"chroma"``   – ChromaDB EphemeralClient (default; no credentials needed).
	* ``"pinecone"`` – Pinecone serverless index (requires ``PINECONE_API_KEY``).

	Raises ``RuntimeError`` with a clear, actionable message if the selected
	backend cannot be initialised. In production, prevents silently switching
	to an empty ephemeral Chroma instance. Secrets are never included in log output.
	"""
	backend = os.getenv("VECTOR_STORE_BACKEND", "chroma").strip().lower() or "chroma"

	if is_production():
		if backend == "chroma" and os.getenv("ALLOW_EPHEMERAL_CHROMA_IN_PRODUCTION", "false").strip().lower() != "true":
			raise RuntimeError(
				"Production environment detected (RENDER=true or ENVIRONMENT=production), "
				"but VECTOR_STORE_BACKEND is set to ephemeral 'chroma'. "
				"Production requires VECTOR_STORE_BACKEND=pinecone with PINECONE_API_KEY and "
				"PINECONE_INDEX_NAME configured. To bypass this guard for testing, set "
				"ALLOW_EPHEMERAL_CHROMA_IN_PRODUCTION=true."
			)

	if backend == "pinecone":
		from db.pinecone_adapter import PineconeAdapter
		return PineconeAdapter()

	if backend == "chroma":
		from db.chroma_adapter import ChromaAdapter
		return ChromaAdapter()

	raise RuntimeError(
		f"Unknown VECTOR_STORE_BACKEND={backend!r}. "
		"Supported values: 'chroma' (default), 'pinecone'."
	)


@asynccontextmanager
async def lifespan(app: FastAPI):
	# Validate required configuration at startup.
	groq_key = os.getenv("GROQ_API_KEY", "").strip()
	if not groq_key:
		if is_production():
			logger.error(
				"CRITICAL: GROQ_API_KEY is not configured in production. "
				"LLM summarization and synthesis will fail. Set GROQ_API_KEY in Render."
			)
		else:
			logger.warning(
				"GROQ_API_KEY is not set. LLM summarization and synthesis will fail. "
				"Set GROQ_API_KEY to enable these features."
			)

	backend_name = os.getenv("VECTOR_STORE_BACKEND", "chroma").strip().lower() or "chroma"
	logger.info("Vector store backend selected: %s", backend_name)

	# Initialise vector store.
	try:
		app.state.vector_store = _build_vector_store()
		logger.info("Vector store initialised successfully (%s).", backend_name)
	except Exception as exc:  # noqa: BLE001
		logger.error("Failed to initialise vector store (%s): %s", backend_name, exc)
		if is_production():
			raise RuntimeError(
				f"Production startup failed: unable to initialise vector store backend ({backend_name}): {exc}"
			) from exc
		app.state.vector_store = None

	# Warm up embedding model at startup so cold-start doesn't stall search requests.
	try:
		from services import embedder
		embedder.warm_up()
	except Exception as exc:  # noqa: BLE001
		logger.warning("Embedder warm-up encountered an issue: %s", exc)

	# Warm up reranker if explicitly enabled in environment
	try:
		from services import reranker
		reranker.warm_up()
	except Exception as exc:  # noqa: BLE001
		logger.warning("Reranker warm-up issue: %s", exc)

	logger.info("Scholytics backend started.")
	yield
	logger.info("Scholytics backend shutting down.")


app = FastAPI(
	title="Scholytics API",
	description=(
		"Semantic research discovery: arXiv search, paper summaries, "
		"streaming synthesis, and relationship graph construction."
	),
	version="1.0.0",
	lifespan=lifespan,
	# Do not expose internal traceback details in production error responses.
	docs_url="/docs",
	redoc_url="/redoc",
)


class RequestObservabilityMiddleware(BaseHTTPMiddleware):
	"""
	Propagates request ID, logs structured request lifecycle, and measures end-to-end latency.
	"""

	async def dispatch(self, request: Request, call_next) -> Response:
		raw_req_id = request.headers.get("x-request-id", "").strip()
		if raw_req_id and _SAFE_REQ_ID_PATTERN.match(raw_req_id):
			req_id = raw_req_id
		else:
			req_id = generate_request_id()

		set_request_id(req_id)
		start_time = time.perf_counter()

		path = request.url.path
		method = request.method
		logger.info("Request started: %s %s [req_id=%s]", method, path, req_id)

		try:
			response = await call_next(request)
			elapsed_ms = (time.perf_counter() - start_time) * 1000.0

			response.headers["X-Request-ID"] = req_id
			response.headers["X-Response-Time-Ms"] = f"{elapsed_ms:.2f}"

			metrics.record_request(method, response.status_code)
			logger.info(
				"Request completed: %s %s -> %d (%.2fms) [req_id=%s]",
				method,
				path,
				response.status_code,
				elapsed_ms,
				req_id,
			)
			return response
		except Exception as exc:  # noqa: BLE001
			elapsed_ms = (time.perf_counter() - start_time) * 1000.0
			metrics.record_request(method, 500)
			logger.error(
				"Request failed: %s %s (%.2fms) [req_id=%s]: %s",
				method,
				path,
				elapsed_ms,
				req_id,
				exc,
			)
			raise


app.add_middleware(RequestObservabilityMiddleware)

app.add_middleware(
	CORSMiddleware,
	allow_origins=get_allowed_origins(),
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)

app.include_router(search_router)
app.include_router(papers_router)
app.include_router(graph_router)
app.include_router(ingest_router)


@app.get("/", tags=["health"])
async def root_health_check() -> dict[str, str]:
	"""Liveness check alias — returns ok when the process is running."""
	return {"status": "ok"}


@app.get("/health/live", tags=["health"])
async def liveness_check() -> dict[str, object]:
	"""
	Lightweight process liveness probe.

	Verifies that the HTTP server process is running and responding to requests.
	Does NOT make external network or dependency calls.
	"""
	summary = metrics.get_summary()
	return {
		"status": "alive",
		"version": "1.0.0",
		"uptime_seconds": summary["uptime_seconds"],
	}


@app.get("/health/ready", tags=["health"])
async def readiness_check() -> dict[str, object]:
	"""
	Readiness check — reports whether key process dependencies are available.

	Checks in-memory configuration, vector store adapter initialization,
	embedder readiness, and reranker status.
	Does NOT make external network calls on every request.
	"""
	vector_store = getattr(app.state, "vector_store", None)
	groq_key_configured = bool(os.getenv("GROQ_API_KEY", "").strip())
	backend_name = os.getenv("VECTOR_STORE_BACKEND", "chroma").strip().lower() or "chroma"

	from services import embedder, reranker
	emb_status = embedder.get_status()
	rerank_status = reranker.get_status()

	issues: list[str] = []
	if vector_store is None:
		issues.append(f"Vector store ({backend_name}) is unavailable")
	if not groq_key_configured:
		issues.append("GROQ_API_KEY is not configured")
	if emb_status.get("status") in ("unavailable", "error"):
		issues.append(f"Embedder unavailable: {emb_status.get('reason')}")

	return {
		"status": "ready" if not issues else "degraded",
		"vector_store": "ok" if vector_store is not None else "unavailable",
		"vector_store_backend": backend_name,
		"groq_configured": groq_key_configured,
		"embedder": emb_status,
		"reranker": rerank_status,
		"issues": issues,
	}


@app.get("/api/metrics", tags=["observability"])
async def get_metrics() -> dict[str, object]:
	"""
	Operational telemetry, counters, and rolling stage latencies.

	Note: Metrics are stored transiently in memory and will reset whenever
	the free-tier server sleeps or restarts.
	"""
	return metrics.get_summary()


@app.post("/api/metrics/reset", tags=["observability"])
async def reset_metrics() -> dict[str, str]:
	"""Reset in-memory counters and latency buffers (for testing/benchmarking)."""
	metrics.reset()
	return {"status": "reset"}


@app.get("/api/cache/stats", tags=["cache"])
async def cache_stats() -> dict[str, object]:
	"""Diagnostic cache telemetry and memory usage."""
	from services.cache import get_all_cache_stats
	return get_all_cache_stats()


@app.post("/api/cache/clear", tags=["cache"])
async def clear_cache() -> dict[str, str]:
	"""Evict all disposable in-memory caches."""
	from services.cache import clear_all_caches
	clear_all_caches()
	return {"status": "cleared"}
