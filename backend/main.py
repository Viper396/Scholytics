import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db.chroma_client import get_collection
from routers.graph import router as graph_router
from routers.papers import router as papers_router
from routers.search import router as search_router


def get_allowed_origins() -> list[str]:
    frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000").strip()
    return [frontend_origin] if frontend_origin else []


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize a shared Chroma collection on startup.
    app.state.chroma_collection = get_collection()
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
