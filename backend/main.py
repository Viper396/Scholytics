import os
from contextlib import asynccontextmanager
from pathlib import Path

import chromadb
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers.graph import router as graph_router
from routers.papers import router as papers_router
from routers.search import router as search_router


def get_allowed_origins() -> list[str]:
    frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000").strip()
    return [frontend_origin] if frontend_origin else []


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize a shared ChromaDB client on startup.
    chroma_path = Path(__file__).resolve().parent / ".chroma"
    app.state.chroma_client = chromadb.PersistentClient(path=str(chroma_path))
    yield


app = FastAPI(lifespan=lifespan)

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


@app.get("/")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}
