"use client";

import React from "react";

export type PaperResult = {
  arxiv_id: string;
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  categories: string[];
  pdf_url: string;
  entry_url: string;
  relevance_score: number | null;
  ranking_degraded?: boolean;
};

export type PaperCardProps = {
  paper: PaperResult;
  inGraph: boolean;
  isSaved: boolean;
  inCompare: boolean;
  abstractExpanded: boolean;
  summaryState?: {
    loading?: boolean;
    error?: string;
    summary?: string;
    open?: boolean;
  };
  onToggleAbstract: (id: string) => void;
  onToggleGraph: (id: string) => void;
  onToggleCompare: (id: string) => void;
  onToggleSaved: (paper: PaperResult) => void;
  onSummarize: (id: string) => void;
};

function clampScore(score: number | null): number {
  if (score === null || Number.isNaN(score)) return 0;
  return Math.max(0, Math.min(1, score));
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function PaperCard({
  paper,
  inGraph,
  isSaved,
  inCompare,
  abstractExpanded,
  summaryState,
  onToggleAbstract,
  onToggleGraph,
  onToggleCompare,
  onToggleSaved,
  onSummarize,
}: PaperCardProps) {
  const score = clampScore(paper.relevance_score);
  const arxivUrl = paper.entry_url || `https://arxiv.org/abs/${paper.arxiv_id}`;

  return (
    <article
      id={`paper-${paper.arxiv_id}`}
      className="flex flex-col rounded-[18px] p-5 transition-all shadow-sm focus-within:ring-2 focus-within:ring-[var(--border-focus)]"
      style={{
        border: inGraph
          ? "1px solid rgba(6,182,212,0.45)"
          : "1px solid var(--border-subtle)",
        backgroundColor: inGraph ? "rgba(11,22,40,0.95)" : "var(--bg-surface)",
      }}
      aria-label={`Paper: ${paper.title}`}
    >
      {/* Header metadata row: categories + arXiv identifier badge */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" aria-label="Paper categories">
          {paper.categories.slice(0, 3).map((category) => (
            <span
              key={`${paper.arxiv_id}-${category}`}
              className="rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{
                border: "1px solid var(--border-subtle)",
                backgroundColor: "var(--bg-elevated)",
                color: "var(--text-accent-dim)",
              }}
            >
              {category}
            </span>
          ))}
          {paper.categories.length > 3 && (
            <span
              className="text-[10px] self-center"
              style={{ color: "var(--text-muted)" }}
            >
              +{paper.categories.length - 3}
            </span>
          )}
        </div>

        <a
          href={arxivUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-md px-2 py-0.5 font-mono text-[11px] font-bold transition-colors hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)]"
          style={{
            backgroundColor: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-accent-dim)",
          }}
          aria-label={`arXiv abstract for ${paper.arxiv_id}`}
          title="Open arXiv abstract page"
        >
          arXiv:{paper.arxiv_id}
        </a>
      </div>

      {/* Title */}
      <h4
        className="mb-1.5 text-base sm:text-lg font-semibold leading-snug line-clamp-2"
        style={{ color: "var(--text-primary)" }}
      >
        <a
          href={arxivUrl}
          target="_blank"
          rel="noreferrer"
          className="hover:underline transition-colors"
          style={{ color: "inherit" }}
        >
          {paper.title}
        </a>
      </h4>

      {/* Authors */}
      <p
        className="mb-1 text-xs line-clamp-1"
        style={{ color: "var(--text-secondary)" }}
      >
        {paper.authors.slice(0, 4).join(", ") || "Unknown authors"}
        {paper.authors.length > 4 && ` +${paper.authors.length - 4} more`}
      </p>

      {/* Publication Date */}
      <p className="mb-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
        Published: {formatDate(paper.published)}
      </p>

      {/* Relevance metric bar (cosine similarity to query - not quality score) */}
      {paper.relevance_score !== null && !paper.ranking_degraded && (
        <div
          className="mb-3.5 rounded-lg px-2.5 py-2"
          style={{
            backgroundColor: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div
            className="mb-1.5 flex items-center justify-between text-xs"
            style={{ color: "var(--text-secondary)" }}
          >
            <span className="flex items-center gap-1.5 text-[11px] font-medium">
              <span>Cosine similarity</span>
              <span
                className="cursor-help rounded-full px-1 text-[10px]"
                style={{
                  backgroundColor: "var(--bg-input)",
                  color: "var(--text-muted)",
                  border: "1px solid var(--border-subtle)",
                }}
                title="Vector cosine similarity to search query text. Reflects query semantic relevance, not paper quality or peer review."
                aria-label="Cosine similarity to query text (retrieval relevance, not paper quality)"
              >
                ⓘ
              </span>
            </span>
            <span
              className="font-mono font-bold text-xs"
              style={{ color: "var(--text-accent)" }}
            >
              {(score * 100).toFixed(1)}%
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full"
            style={{ backgroundColor: "var(--bg-input)" }}
            role="meter"
            aria-label={`Query semantic similarity: ${(score * 100).toFixed(1)}% (retrieval relevance, not paper quality)`}
            aria-valuenow={Math.round(score * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${(score * 100).toFixed(1)}%`,
                background:
                  "linear-gradient(90deg, var(--cyan-dim), var(--cyan-primary))",
              }}
            />
          </div>
        </div>
      )}

      {/* Abstract with toggle */}
      <div className="mb-4 flex-1 text-xs sm:text-sm" style={{ color: "var(--text-secondary)" }}>
        <p className={abstractExpanded ? "leading-relaxed" : "line-clamp-3 leading-relaxed"}>
          {paper.abstract}
        </p>
        {paper.abstract.length > 200 && (
          <button
            type="button"
            onClick={() => onToggleAbstract(paper.arxiv_id)}
            className="mt-1 text-xs font-semibold transition-colors hover:underline focus-visible:outline-none"
            style={{ color: "var(--text-accent)" }}
            aria-expanded={abstractExpanded}
            aria-controls={`abstract-${paper.arxiv_id}`}
          >
            {abstractExpanded ? "Show less" : "Read more"}
          </button>
        )}
      </div>

      {/* Action buttons */}
      <div
        className="flex flex-wrap items-center gap-1.5 pt-3 border-t"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <button
          type="button"
          onClick={() => onSummarize(paper.arxiv_id)}
          disabled={summaryState?.loading}
          className="rounded-lg px-3 py-1.5 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          style={{
            backgroundColor: "var(--cyan-primary)",
            color: "var(--cyan-text)",
          }}
          onMouseEnter={(e) => {
            if (!summaryState?.loading)
              e.currentTarget.style.backgroundColor = "var(--cyan-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "var(--cyan-primary)";
          }}
          aria-label={
            summaryState?.loading
              ? "Generating summary…"
              : `Summarize: ${paper.title}`
          }
        >
          {summaryState?.loading ? "Summarizing…" : "Summarize"}
        </button>

        <button
          type="button"
          onClick={() => onToggleGraph(paper.arxiv_id)}
          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          style={
            inGraph
              ? {
                  backgroundColor: "rgba(16,185,129,0.12)",
                  border: "1px solid rgba(16,185,129,0.4)",
                  color: "#34d399",
                }
              : {
                  border: "1px solid var(--border-subtle)",
                  backgroundColor: "var(--bg-elevated)",
                  color: "var(--text-secondary)",
                }
          }
          aria-pressed={inGraph}
          aria-label={
            inGraph
              ? `Remove ${paper.title} from graph`
              : `Add ${paper.title} to graph`
          }
        >
          {inGraph ? "✓ In Graph" : "Add to Graph"}
        </button>

        <button
          type="button"
          onClick={() => onToggleCompare(paper.arxiv_id)}
          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          style={
            inCompare
              ? {
                  backgroundColor: "rgba(6,182,212,0.18)",
                  border: "1px solid rgba(6,182,212,0.45)",
                  color: "var(--text-accent)",
                }
              : {
                  border: "1px solid var(--border-subtle)",
                  backgroundColor: "var(--bg-elevated)",
                  color: "var(--text-secondary)",
                }
          }
          aria-pressed={inCompare}
          aria-label={
            inCompare
              ? `Remove ${paper.title} from comparison`
              : `Add ${paper.title} to comparison`
          }
        >
          {inCompare ? "✓ In Compare" : "+ Compare"}
        </button>

        <button
          type="button"
          onClick={() => onToggleSaved(paper)}
          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          style={
            isSaved
              ? {
                  backgroundColor: "rgba(245,158,11,0.1)",
                  border: "1px solid rgba(245,158,11,0.35)",
                  color: "#fbbf24",
                }
              : {
                  border: "1px solid var(--border-subtle)",
                  backgroundColor: "var(--bg-elevated)",
                  color: "var(--text-secondary)",
                }
          }
          aria-pressed={isSaved}
          aria-label={
            isSaved
              ? `Remove ${paper.title} from reading list`
              : `Save ${paper.title} to reading list`
          }
        >
          {isSaved ? "★ Saved" : "Save"}
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <a
            href={arxivUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            style={{
              border: "1px solid var(--border-subtle)",
              backgroundColor: "var(--bg-elevated)",
              color: "var(--text-secondary)",
            }}
            aria-label={`Open arXiv abstract page for: ${paper.title}`}
          >
            arXiv ↗
          </a>

          <a
            href={paper.pdf_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            style={{
              border: "1px solid var(--border-subtle)",
              backgroundColor: "var(--bg-elevated)",
              color: "var(--text-secondary)",
            }}
            aria-label={`Open PDF for: ${paper.title}`}
          >
            PDF ↗
          </a>
        </div>
      </div>

      {/* Summary panel drawer */}
      {summaryState?.open && (
        <div
          className="mt-3 rounded-xl p-3.5 transition-all"
          style={{
            border: "1px solid rgba(6,182,212,0.25)",
            backgroundColor: "var(--bg-page)",
          }}
          role="region"
          aria-label={`AI summary for ${paper.title}`}
        >
          {summaryState.loading && (
            <div className="flex items-center gap-2 py-1">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
              <p
                className="text-xs font-medium"
                style={{ color: "var(--text-accent)" }}
                aria-live="polite"
              >
                Generating summary…
              </p>
            </div>
          )}
          {!summaryState.loading && summaryState.error && (
            <div className="flex flex-col items-start gap-2">
              <p className="text-xs font-medium" style={{ color: "#fda4af" }} role="alert">
                {summaryState.error}
              </p>
              <button
                type="button"
                onClick={() => onSummarize(paper.arxiv_id)}
                disabled={summaryState.loading}
                className="rounded-md px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  backgroundColor: "rgba(239,68,68,0.15)",
                  border: "1px solid rgba(239,68,68,0.35)",
                  color: "#fca5a5",
                }}
                aria-label={`Retry summary for ${paper.title}`}
              >
                Retry
              </button>
            </div>
          )}
          {!summaryState.loading && !summaryState.error && summaryState.summary && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p
                  className="text-xs font-bold uppercase tracking-widest"
                  style={{ color: "var(--text-accent-dim)" }}
                >
                  AI Abstract Summary
                </p>
                <span
                  className="rounded px-1.5 py-0.2 text-[10px]"
                  style={{
                    backgroundColor: "var(--cyan-subtle)",
                    color: "var(--text-accent)",
                  }}
                >
                  Groq Llama 3.1 8B
                </span>
              </div>
              <p
                className="text-xs leading-6"
                style={{ color: "var(--text-secondary)" }}
              >
                {summaryState.summary}
              </p>
              <p className="mt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                ⚠ Grounded on title & abstract only — not full paper text.
              </p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
