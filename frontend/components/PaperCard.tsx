"use client";

import React, { useState } from "react";

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
  const [authorsExpanded, setAuthorsExpanded] = useState(false);
  const score = clampScore(paper.relevance_score);
  const scorePercent = (score * 100).toFixed(1);
  const arxivUrl = paper.entry_url || `https://arxiv.org/abs/${paper.arxiv_id}`;
  const pdfUrl = paper.pdf_url || `https://arxiv.org/pdf/${paper.arxiv_id}`;

  const hasManyAuthors = paper.authors.length > 5;
  const displayedAuthors =
    hasManyAuthors && !authorsExpanded
      ? paper.authors.slice(0, 4).join(", ")
      : paper.authors.join(", ");

  return (
    <article
      id={`paper-${paper.arxiv_id}`}
      className={`group relative flex flex-col justify-between rounded-xl p-5 sm:p-6 transition-all duration-200 border scroll-mt-20 ${
        inGraph
          ? "border-cyan-400/50 bg-[#0c1d33] shadow-[0_4px_20px_rgba(34,211,238,0.1)]"
          : "border-[#1d3658] bg-[#0c1a2e] hover:border-[#2b4f7c] hover:bg-[#0f213a] shadow-sm hover:shadow-md"
      }`}
      aria-label={`Paper: ${paper.title}`}
    >
      <div className="flex flex-col gap-3">
        {/* 1. Title (Full readability, no premature truncations) */}
        <h4 className="text-base sm:text-lg font-semibold leading-snug tracking-tight text-[#f0f5fc] transition-colors group-hover:text-cyan-300">
          <a
            href={arxivUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded"
          >
            {paper.title}
          </a>
        </h4>

        {/* 2. Authors and Publication Date */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#9cb3cf]">
          <span>
            {displayedAuthors || "Unknown authors"}
            {hasManyAuthors && !authorsExpanded && (
              <button
                type="button"
                onClick={() => setAuthorsExpanded(true)}
                className="ml-1 text-cyan-400 hover:underline"
              >
                +{paper.authors.length - 4} more
              </button>
            )}
            {hasManyAuthors && authorsExpanded && (
              <button
                type="button"
                onClick={() => setAuthorsExpanded(false)}
                className="ml-1 text-[#607899] hover:underline"
              >
                (show less)
              </button>
            )}
          </span>
          <span className="text-[#607899]" aria-hidden="true">·</span>
          <time dateTime={paper.published} className="text-[#607899] shrink-0">
            {formatDate(paper.published)}
          </time>
        </div>

        {/* 3. arXiv Link and Categories */}
        <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
          <div className="flex items-center gap-1.5 flex-wrap" aria-label="Paper categories">
            {paper.categories.map((category, idx) => (
              <span
                key={`${paper.arxiv_id}-${category}`}
                className={`rounded px-2 py-0.5 font-mono text-[11px] font-medium ${
                  idx === 0
                    ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/30"
                    : "bg-[#11233d] text-[#9cb3cf] border border-[#1d3658]"
                }`}
              >
                {category}
              </span>
            ))}
          </div>

          <a
            href={arxivUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-[#1d3658] bg-[#11233d] px-2 py-0.5 font-mono text-[11px] font-medium text-cyan-400 transition-colors hover:border-cyan-500/40 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
            aria-label={`arXiv abstract for ${paper.arxiv_id}`}
            title="Open abstract page on arXiv"
          >
            arXiv:{paper.arxiv_id}
          </a>
        </div>

        {/* 4. Concise Abstract Preview with Expansion Toggle */}
        <div className="text-xs sm:text-sm text-[#9cb3cf] leading-relaxed pt-1">
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

        {/* 5. Relevance (Vector Cosine Similarity to Query Text) */}
        {paper.relevance_score !== null && !paper.ranking_degraded && (
          <div className="rounded-lg border border-[#1d3658] bg-[#071526] p-2.5 my-1">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#9cb3cf]">
                <span>Semantic relevance</span>
                <span
                  className="cursor-help rounded bg-[#11233d] px-1 text-[10px] text-[#607899] border border-[#1d3658]"
                  title="Vector cosine similarity to search query text. Reflects query semantic relevance, not paper quality or citation impact."
                  aria-label="Cosine similarity to query text (retrieval relevance, not paper quality)"
                >
                  ⓘ
                </span>
              </span>
              <span className="font-mono text-xs font-semibold text-cyan-400">
                {scorePercent}%
              </span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-[#11233d]"
              role="meter"
              aria-label={`Query semantic similarity: ${scorePercent}% (retrieval relevance, not paper quality)`}
              aria-valuenow={Math.round(score * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-cyan-400 transition-all duration-300"
                style={{ width: `${scorePercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 6. Action Toolbar with Clear Priority Hierarchy */}
      <div className="mt-4 pt-3.5 border-t border-[#1d3658] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Primary Action: Summarize Paper */}
          <button
            type="button"
            onClick={() => onSummarize(paper.arxiv_id)}
            disabled={summaryState?.loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400/15 border border-cyan-400/40 px-3 py-1.5 text-xs font-bold text-cyan-300 transition-colors hover:bg-cyan-400/25 hover:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
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

          {/* Secondary Action: Add to Graph */}
          <button
            type="button"
            onClick={() => onToggleGraph(paper.arxiv_id)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
              inGraph
                ? "bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-semibold"
                : "bg-[#11233d] border border-[#1d3658] text-[#9cb3cf] hover:border-[#2b4f7c] hover:text-[#f0f5fc]"
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

          {/* Secondary Action: Add to Compare */}
          <button
            type="button"
            onClick={() => onToggleCompare(paper.arxiv_id)}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
              inCompare
                ? "bg-cyan-500/15 border border-cyan-400/40 text-cyan-300 font-semibold"
                : "bg-[#11233d] border border-[#1d3658] text-[#9cb3cf] hover:border-[#2b4f7c] hover:text-[#f0f5fc]"
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

          {/* Secondary Action: Save to Reading List */}
          <button
            type="button"
            onClick={() => onToggleSaved(paper)}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
              isSaved
                ? "bg-amber-500/15 border border-amber-500/40 text-amber-400 font-semibold"
                : "bg-[#11233d] border border-[#1d3658] text-[#9cb3cf] hover:border-amber-500/40 hover:text-amber-300"
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

        {/* External Links */}
        <div className="flex items-center gap-1 text-xs">
          <a
            href={arxivUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-[#1d3658] bg-[#11233d] px-2 py-1 font-mono text-[11px] font-medium text-[#9cb3cf] transition-colors hover:border-cyan-500/40 hover:text-cyan-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
            aria-label={`Open arXiv abstract page for: ${paper.title}`}
            title="Open abstract on arXiv"
          >
            arXiv ↗
          </a>
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-[#1d3658] bg-[#11233d] px-2 py-1 font-mono text-[11px] font-medium text-cyan-400 transition-colors hover:border-cyan-400 hover:bg-cyan-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
            aria-label={`Open PDF for: ${paper.title}`}
            title="Open direct paper PDF"
          >
            PDF ↗
          </a>
        </div>
      </div>

      {/* 7. Summary Accordion Drawer (Embedded in Card) */}
      {summaryState?.open && (
        <div
          className="mt-3.5 rounded-lg border border-cyan-500/30 bg-[#071526] p-4 transition-all"
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
                <span className="rounded border border-[#1d3658] bg-[#11233d] px-1.5 py-0.2 font-mono text-[10px] text-[#9cb3cf]">
                  Groq Llama 3.1 8B
                </span>
              </div>
              <p className="text-xs text-[#f0f5fc] leading-relaxed">
                {summaryState.summary}
              </p>
              <p className="text-[11px] text-[#607899]">
                ⚠ Grounded on title &amp; abstract only — not full paper text.
              </p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
