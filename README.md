# Scholytics

## About (GitHub Repo Blurb)

AI-powered research copilot that combines live arXiv semantic search, streaming synthesis, and an interactive citation relationship graph.

## Overview

Scholytics helps students and developers quickly understand fast-moving research without manually reading dozens of papers end to end. It uses a Retrieval-Augmented Generation (RAG) pipeline: fetches live papers from arXiv, embeds and indexes them, retrieves the most relevant results, and then generates paper-level summaries plus topic-level synthesis. Beyond search, it builds an interactive citation-style relationship graph so users can explore how papers connect by shared authors and research fields. The platform is built with a FastAPI backend, ChromaDB vector retrieval, sentence-transformers embeddings, Groq-hosted LLM inference, and a Next.js + D3 frontend.

## Features

- Semantic search over live arXiv data
- Groq-powered paper summaries
- Streaming topic synthesis for "what does current research say about X"
- Interactive D3 citation graph for exploring paper relationships
- Filter controls by category and date

## Tech Stack

| Layer         | Technology                                       | Notes                                                                   |
| ------------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| Backend       | FastAPI (Python)                                 | API orchestration for search, summaries, synthesis, and graph endpoints |
| Vector DB     | ChromaDB                                         | Dense vector storage and nearest-neighbor retrieval                     |
| Embeddings    | sentence-transformers (all-MiniLM-L6-v2)         | Local embedding generation for low-latency semantic indexing            |
| LLM           | Groq API (Llama 3.1 8B Instant)                  | Hosted generation for summaries and streaming synthesis                 |
| Frontend      | Next.js 14 + TypeScript + Tailwind CSS           | App Router UI for search, synthesis, and graph workflows                |
| Visualization | D3.js (d3-force, d3-zoom)                        | Force-directed interactive research relationship graph                  |
| Deployment    | Local-first, cloud-ready (e.g., Render + Vercel) | Backend/frontend split architecture suitable for independent scaling    |

## Engineering Decisions

### 1) Why local embeddings + hosted LLM

Using local embeddings with a hosted LLM separates retrieval cost from generation cost, which keeps frequent search/index operations cheap and responsive while still getting high-quality generation output when needed. Embeddings are deterministic and reusable, so once a paper is indexed, retrieval remains fast and consistent across sessions. The hosted LLM is then used only for value-added tasks (summaries and synthesis), which is easier to scale and monitor than running a full local generative stack.

### 2) Why live arXiv search instead of a static corpus

A static corpus goes stale quickly in ML and AI domains, where important papers appear daily. Live arXiv retrieval ensures users see current research trends without waiting for a periodic ingestion pipeline to refresh data. This choice also makes the system more realistic for production research tooling: it reflects real-world data freshness constraints and demonstrates robust handling of dynamic content.

### 3) Why a force-directed graph for citations and relationships

Search lists are great for ranking but weak for showing structure; a force-directed graph makes clusters, bridges, and outliers visually obvious. Mapping co-author and same-field edges helps users discover adjacent papers they might miss in a linear results view. This design supports exploratory analysis and interview-ready discussion about human-centered UX for graph-based knowledge navigation.
