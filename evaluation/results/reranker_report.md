# Scholytics Reranker Investigation: Hybrid vs. Hybrid + Cross-Encoder

**Generated**: 2026-10-29T09:58:02.735064+00:00  
**Evaluated Model**: `cross-encoder/ms-marco-TinyBERT-L-2-v2`  
**Test Corpus**: Scholytics Benchmark Dataset (8 academic queries, 33 real arXiv papers)

---

## 1. Executive Summary & Recommendation

- **Ranking Quality**: Reranking hybrid results yields **no meaningful improvement in Top-1 or Top-3 precision** and only marginal change in nDCG@5:
  - **nDCG@3**: Hybrid Baseline = `0.8878` vs. Reranked = `0.904`
  - **nDCG@5**: Hybrid Baseline = `0.9255` vs. Reranked = `0.9195`
  - **MRR**: `1.0` vs. `1.0` (Identical: 1.0000)
  - **Precision@1**: `1.0` vs. `1.0` (Identical: 1.0000)
- **Latency Impact**: Reranking adds **+70.48 ms** of CPU inference latency on average (p50: `34.39 ms`, p95: `176.81 ms`).
- **Memory & Deployment Feasibility**:
  - Cold-start model initialization took **4233.9 ms** (4.23s).
  - Total process memory increased from **411.0 MB** to **859.6 MB** (+448.6 MB).
  - On Render free tier (512 MB limit, 0.1-0.5 shared CPU), running PyTorch + CrossEncoder alongside FastEmbed and Uvicorn brings RAM utilization past 85% of total capacity, creating severe OOM (Exit code 137) risk during concurrent requests.
- **Decision Recommendation**:
  **Do NOT enable cross-encoder reranking by default in production**. The hybrid dense+BM25 pipeline with tuned RRF ($k=10.0$) already captures both semantic similarity and exact keyword matching with sub-second response times and a low-memory profile. The reranker service and configuration flag (`ENABLE_RERANKER=false`) are preserved for high-resource deployments.

---

## 2. Comparative Benchmark Metrics

| Metric | Hybrid Baseline (Tuned RRF k=10) | Hybrid + Cross-Encoder Reranker | Delta |
| :--- | :---: | :---: | :---: |
| **Precision@1** | 1.0 | 1.0 | +0.0000 |
| **Precision@3** | 0.9167 | 0.9167 | +0.0000 |
| **Precision@5** | 0.75 | 0.75 | +0.0000 |
| **Recall@3** | 0.75 | 0.75 | +0.0000 |
| **Recall@5** | 0.975 | 0.975 | +0.0000 |
| **MRR** | 1.0 | 1.0 | +0.0000 |
| **nDCG@3** | 0.8878 | 0.904 | +0.0162 |
| **nDCG@5** | 0.9255 | 0.9195 | -0.0060 |
| **p50 Latency** | 342.56 ms | 400.93 ms | +58.4 ms |
| **p95 Latency** | 561.9 ms | 704.18 ms | +142.3 ms |
| **Mean Latency** | 390.39 ms | 460.86 ms | +70.5 ms |

---

## 3. Candidate Pool Ablation

Evaluating different candidate limits ($N$) passed to the cross-encoder:

| Max Candidates ($N$) | nDCG@3 | nDCG@5 | Rerank p50 Latency | Rerank p95 Latency | Rerank Mean Latency |
| :---: | :---: | :---: | :---: | :---: | :---: |
| **5** | 0.904 | 0.9271 | 17.81 ms | 80.37 ms | 28.84 ms |
| **10** | 0.904 | 0.9195 | 21.97 ms | 126.72 ms | 56.38 ms |
| **15** | 0.904 | 0.9195 | 20.98 ms | 164.33 ms | 53.46 ms |

---

## 4. Resource & Deployment Profile

| Dimension | Baseline (Hybrid RRF) | With Reranker (ms-marco-TinyBERT-L-2-v2) |
| :--- | :--- | :--- |
| **Dependency Footprint** | FastEmbed (ONNX) + local BM25 (~150 MB) | Requires PyTorch / Sentence-Transformers (+400 MB) |
| **Memory Working Set** | ~280 MB - 310 MB | **~859.6 MB** (near 512 MB Render limit) |
| **Cold Start Overhead** | ~1.5s - 2.5s | **+4.23s** additional model load time |
| **Throughput & Concurrency** | Highly resilient under shared vCPU | CPU-bound quadratic cross-attention causes request queuing |
| **Failure Safety** | Graceful fallback to unranked | Default disabled (`ENABLE_RERANKER=false`) with automatic bypass on failure |
