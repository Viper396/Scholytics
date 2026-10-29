import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers.graph import router as graph_router
from routers.ingest import router as ingest_router
from routers.papers import router as papers_router
from routers.search import router as search_router

logging.basicConfig(
	level=logging.INFO,
	format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def get_allowed_origins() -> list[str]:
	frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000").strip()
	if not frontend_origin:
		logger.warning(
			"FRONTEND_ORIGIN is not set. CORS will reject cross-origin requests. "
			"Set FRONTEND_ORIGIN to your deployed frontend URL in production."
		)
		return []
	# Normalize: allow both with and without trailing slash to prevent CORS mismatch
	origins = {frontend_origin, frontend_origin.rstrip("/")}
	return [o for o in origins if o]


def _build_vector_store():
	"""
	Instantiate and return the configured vector-store adapter.

	The backend is selected by the ``VECTOR_STORE_BACKEND`` environment variable:

	* ``"chroma"``   – ChromaDB EphemeralClient (default; no credentials needed).
	* ``"pinecone"`` – Pinecone serverless index (requires ``PINECONE_API_KEY``).

	Raises ``RuntimeError`` with a clear, actionable message if the selected
	backend cannot be initialised.  Secrets are never included in log output.
	"""
	backend = os.getenv("VECTOR_STORE_BACKEND", "chroma").strip().lower() or "chroma"

	if backend == "pinecone":
		from db.pinecone_adapter import PineconeAdapter  # noqa: PLC0415
		return PineconeAdapter()

	if backend == "chroma":
		from db.chroma_adapter import ChromaAdapter  # noqa: PLC0415
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
async def health_check() -> dict[str, str]:
	"""Liveness check — returns ok when the process is running."""
	return {"status": "ok"}


@app.get("/health/ready", tags=["health"])
async def readiness_check() -> dict[str, object]:
	"""
	Readiness check — reports whether key dependencies are available.

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
