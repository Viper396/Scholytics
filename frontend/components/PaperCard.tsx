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
  const scorePercent = (score * 100).toFixed(1);
  const arxivUrl = paper.entry_url || `https://arxiv.org/abs/${paper.arxiv_id}`;

  return (
    <article
      id={`paper-${paper.arxiv_id}`}
      className={`group relative flex flex-col justify-between rounded-2xl p-5 sm:p-6 transition-all duration-200 border ${
        inGraph
          ? "border-cyan-400/50 bg-[#0c1c33] shadow-[0_4px_24px_rgba(34,211,238,0.12)]"
          : "border-[#1e385c] bg-[#0c1a2e] hover:border-[#2a4d7d] hover:bg-[#0f2038] shadow-md hover:shadow-xl"
      } focus-within:ring-2 focus-within:ring-cyan-400`}
      aria-label={`Paper: ${paper.title}`}
    >
      <div className="flex flex-col gap-3">
        {/* Top Metadata Row */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap" aria-label="Paper categories">
            {paper.categories.slice(0, 3).map((category, idx) => (
              <span
                key={`${paper.arxiv_id}-${category}`}
                className={`rounded-md px-2 py-0.5 text-[11px] font-mono font-medium ${
                  idx === 0
                    ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                    : "bg-[#11223b] text-[#9cb1ce] border border-[#1e385c]"
                }`}
              >
                {category}
              </span>
            ))}
            {paper.categories.length > 3 && (
              <span className="text-[10px] font-mono text-[#5e779a]">
                +{paper.categories.length - 3}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#5e779a]">
              {formatDate(paper.published)}
            </span>
            <a
              href={arxivUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-md border border-[#1e385c] bg-[#11223b] px-2 py-0.5 font-mono text-[11px] font-semibold text-cyan-400/90 transition-colors hover:border-cyan-500/50 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
              aria-label={`arXiv abstract for ${paper.arxiv_id}`}
              title="Open arXiv abstract page"
            >
              arXiv:{paper.arxiv_id}
            </a>
          </div>
        </div>

        {/* Paper Title */}
        <h4 className="text-base sm:text-lg font-semibold leading-snug tracking-tight text-[#eaf2ff] group-hover:text-cyan-300 transition-colors">
          <a
            href={arxivUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:underline focus-visible:outline-none"
          >
            {paper.title}
          </a>
        </h4>

        {/* Authors */}
        <p className="text-xs text-[#9cb1ce] line-clamp-1">
          {paper.authors.slice(0, 4).join(", ") || "Unknown authors"}
          {paper.authors.length > 4 && ` +${paper.authors.length - 4} more`}
        </p>

        {/* Relevance Score (Vector Cosine Similarity Meter) */}
        {paper.relevance_score !== null && !paper.ranking_degraded && (
          <div className="rounded-xl border border-[#1e385c]/80 bg-[#081526] p-2.5 my-0.5">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#9cb1ce]">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                <span>Cosine similarity</span>
                <span
                  className="cursor-help rounded-full bg-[#11223b] px-1 text-[10px] text-[#5e779a] border border-[#1e385c]"
                  title="Vector cosine similarity to search query text. Reflects query semantic relevance, not paper quality or peer review."
                  aria-label="Cosine similarity to query text (retrieval relevance, not paper quality)"
                >
                  ⓘ
                </span>
              </span>
              <span className="font-mono text-xs font-bold text-cyan-400">
                {scorePercent}%
              </span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-[#11223b]"
              role="meter"
              aria-label={`Query semantic similarity: ${scorePercent}% (retrieval relevance, not paper quality)`}
              aria-valuenow={Math.round(score * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-600 via-cyan-400 to-[#38bdf8] transition-all duration-300"
                style={{ width: `${scorePercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Abstract */}
        <div className="text-xs sm:text-sm text-[#9cb1ce] leading-relaxed">
          <p className={abstractExpanded ? "leading-relaxed" : "line-clamp-3 leading-relaxed"}>
            {paper.abstract}
          </p>
          {paper.abstract.length > 180 && (
            <button
              type="button"
              onClick={() => onToggleAbstract(paper.arxiv_id)}
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-cyan-400 hover:text-cyan-300 hover:underline focus-visible:outline-none"
              aria-expanded={abstractExpanded}
              aria-controls={`abstract-${paper.arxiv_id}`}
            >
              {abstractExpanded ? "Show less" : "Read more"}
            </button>
          )}
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="mt-4 pt-3.5 border-t border-[#1e385c]/80 flex flex-wrap items-center justify-between gap-2">
        {/* Primary and quick toggles */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => onSummarize(paper.arxiv_id)}
            disabled={summaryState?.loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/40 px-3 py-1.5 text-xs font-bold text-cyan-300 transition-all hover:bg-cyan-500/25 hover:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            aria-label={
              summaryState?.loading
                ? "Generating summary…"
                : `Summarize: ${paper.title}`
            }
          >
            {summaryState?.loading ? (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                <span>Summarizing…</span>
              </>
            ) : (
              <>
                <span aria-hidden="true" className="text-cyan-400">✦</span>
                <span>Summarize</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => onToggleGraph(paper.arxiv_id)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
              inGraph
                ? "bg-emerald-500/15 border border-emerald-500/40 text-emerald-400"
                : "bg-[#11223b] border border-[#1e385c] text-[#9cb1ce] hover:border-cyan-500/40 hover:text-[#eaf2ff]"
            }`}
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
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
              inCompare
                ? "bg-cyan-500/20 border border-cyan-400/50 text-cyan-300"
                : "bg-[#11223b] border border-[#1e385c] text-[#9cb1ce] hover:border-cyan-500/40 hover:text-[#eaf2ff]"
            }`}
            aria-pressed={inCompare}
            aria-label={
              inCompare
                ? `Remove ${paper.title} from comparison`
                : `Add ${paper.title} to comparison`
            }
          >
            <span>{inCompare ? "✓ In Compare" : "+ Compare"}</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleSaved(paper)}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
              isSaved
                ? "bg-amber-500/15 border border-amber-500/40 text-amber-400"
                : "bg-[#11223b] border border-[#1e385c] text-[#9cb1ce] hover:border-amber-500/40 hover:text-amber-300"
            }`}
            aria-pressed={isSaved}
            aria-label={
              isSaved
                ? `Remove ${paper.title} from reading list`
                : `Save ${paper.title} to reading list`
            }
          >
            <span>{isSaved ? "★ Saved" : "Save"}</span>
          </button>
        </div>

        {/* External direct links */}
        <div className="flex items-center gap-1.5 text-xs">
          <a
            href={arxivUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-[#1e385c] bg-[#11223b] px-2 py-1 font-mono text-[11px] font-semibold text-[#9cb1ce] transition-colors hover:border-cyan-500/40 hover:text-cyan-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
            aria-label={`Open arXiv abstract page for: ${paper.title}`}
            title="Open abstract on arXiv"
          >
            arXiv ↗
          </a>
          <a
            href={paper.pdf_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-[#1e385c] bg-[#11223b] px-2 py-1 font-mono text-[11px] font-semibold text-cyan-400 transition-colors hover:border-cyan-400 hover:bg-cyan-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
            aria-label={`Open PDF for: ${paper.title}`}
            title="Open direct paper PDF"
          >
            PDF ↗
          </a>
        </div>
      </div>

      {/* Summary Accordion Drawer */}
      {summaryState?.open && (
        <div
          className="mt-3.5 rounded-xl border border-cyan-500/30 bg-[#081526] p-4 transition-all"
          role="region"
          aria-label={`AI summary for ${paper.title}`}
        >
          {summaryState.loading && (
            <div className="flex items-center gap-2.5 py-1 text-xs text-cyan-400">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
              <p className="font-medium" aria-live="polite">
                Generating summary…
              </p>
            </div>
          )}

          {!summaryState.loading && summaryState.error && (
            <div className="flex flex-col items-start gap-2">
              <p className="text-xs font-medium text-rose-300" role="alert">
                {summaryState.error}
              </p>
              <button
                type="button"
                onClick={() => onSummarize(paper.arxiv_id)}
                disabled={summaryState.loading}
                className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/25 disabled:opacity-50"
                aria-label={`Retry summary for ${paper.title}`}
              >
                Retry
              </button>
            </div>
          )}

          {!summaryState.loading && !summaryState.error && summaryState.summary && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-cyan-400">✦</span>
                  <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-cyan-400">
                    AI Abstract Summary
                  </p>
                </div>
                <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-cyan-400">
                  Groq Llama 3.1 8B
                </span>
              </div>
              <p className="text-xs text-[#eaf2ff] leading-relaxed">
                {summaryState.summary}
              </p>
              <p className="text-[11px] text-[#5e779a]">
                ⚠ Grounded on title & abstract only — not full paper text.
              </p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
