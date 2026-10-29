# Scholytics Baseline Retrieval Evaluation Report

**Execution Timestamp**: `2026-10-29T09:16:37.495461+00:00`  
**Pipeline**: `FastEmbed (BAAI/bge-small-en-v1.5) + ChromaDB EphemeralClient (cosine)`  
**Dense Vector Dimension**: `384`  
**Total Queries**: `8` | **Failure Rate**: `0.0%`  
**Binary Relevance Grade Threshold**: `>= 2` (Grades: 3=Highly Relevant, 2=Relevant, 1=Marginal, 0=Irrelevant)  

---

## 1. Aggregate Macro Quality Metrics

| Metric | Value | Description |
| :--- | :---: | :--- |
| **Precision@1** | **1.0000** | Fraction of queries whose #1 result is relevant |
| **Precision@3** | **0.9167** | Fraction of top 3 results that are relevant |
| **Precision@5** | **0.7250** | Fraction of top 5 results that are relevant |
| **Recall@1** | **0.2792** | Proportion of total relevant papers captured at rank 1 |
| **Recall@3** | **0.7500** | Proportion of total relevant papers captured at rank 3 |
| **Recall@5** | **0.9437** | Proportion of total relevant papers captured at rank 5 |
| **MRR** | **1.0000** | Mean Reciprocal Rank of first relevant document |
| **nDCG@3** | **0.8897** | Normalized Discounted Cumulative Gain at rank 3 |
| **nDCG@5** | **0.8889** | Normalized Discounted Cumulative Gain at rank 5 |

---

## 2. Latency Profile (Empirical)

| Stage | Mean (ms) | Median (p50) | 95th Percentile (p95) | Min (ms) | Max (ms) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Candidate Embedding (FastEmbed ONNX)** | 854.5 ms | 852.05 ms | 1444.12 ms | 306.61 ms | 1451.73 ms |
| **Vector Upsert (ChromaDB Ephemeral)** | 33.85 ms | 29.81 ms | 55.09 ms | 17.11 ms | 58.18 ms |
| **Query Embedding (FastEmbed)** | 19.28 ms | 18.21 ms | 35.22 ms | 4.31 ms | 35.42 ms |
| **Vector Query & Cosine Ranking** | 2.93 ms | 2.66 ms | 4.53 ms | 1.96 ms | 4.68 ms |
| **Total Pipeline Latency** | 914.1 ms | 910.55 ms | 1539.48 ms | 334.5 ms | 1554.79 ms |

---

## 3. Per-Query Performance Breakdown

| ID | Query | Domain | P@3 | R@3 | MRR | nDCG@3 | Latency (ms) |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `q1` | Retrieval-augmented generation for knowledge-intensive NLP tasks | Retrieval-Augmented Generation | 1.00 | 0.75 | 1.00 | 1.0000 | 563.7 ms |
| `q2` | Attention mechanisms and transformer architecture in deep learning | Transformers & Attention | 0.67 | 0.40 | 1.00 | 0.5742 | 334.5 ms |
| `q3` | Vision transformers for image classification and recognition | Computer Vision | 1.00 | 0.75 | 1.00 | 1.0000 | 341.0 ms |
| `q4` | Parameter-efficient fine-tuning and low-rank adaptation of large language models | Model Adaptation & Efficiency | 1.00 | 0.75 | 1.00 | 0.8046 | 484.5 ms |
| `q5` | Self-supervised visual representation learning with contrastive methods | Self-Supervised Learning | 1.00 | 0.60 | 1.00 | 1.0000 | 1265.9 ms |
| `q6` | Direct preference optimization and reinforcement learning from human feedback | Alignment & Preference Learning | 0.67 | 1.00 | 1.00 | 0.9341 | 1554.8 ms |
| `q7` | Diffusion models for high-resolution image synthesis and generation | Generative Diffusion Models | 1.00 | 1.00 | 1.00 | 0.9595 | 1511.0 ms |
| `q8` | Graph neural networks for relational learning and molecular property prediction | Graph Representation Learning | 1.00 | 0.75 | 1.00 | 0.8452 | 1257.4 ms |

---

## 4. Methodology & Ground Truth Labeling

1. **Relevance Scale**: Graded relevance on a 4-point scale ($0$ to $3$):
   - **3 (Highly Relevant)**: Canonical literature establishing or directly answering the query topic.
   - **2 (Relevant)**: Direct contribution or substantial algorithmic development on the query topic.
   - **1 (Marginal)**: Foundational precursor architecture (e.g. standard Transformers for CV queries) or broader contextual work.
   - **0 (Irrelevant)**: Cross-domain, distinct task formulation, or distractor candidate.
2. **Label Verification**: All relevance grades were manually verified against canonical literature definitions and peer-reviewed abstracts.
3. **Zero Token Consumption**: The benchmark evaluates embedding and vector search deterministically without calling Groq LLM APIs.
