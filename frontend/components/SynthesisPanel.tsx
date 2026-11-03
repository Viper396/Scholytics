"use client";

import React from "react";
import ReactMarkdown from "react-markdown";

export type SynthesisSource = {
  source_index: number;
  arxiv_id: string;
  title: string;
  authors: string[];
  published: string;
  entry_url: string;
  pdf_url?: string;
  categories: string[];
};

export type SynthesisValidation = {
  cited_sources: number[];
  invalid_citations: number[];
  has_hallucinations: boolean;
  citation_count: number;
};

export type SynthesisPanelProps = {
  activeQuery: string;
  isSynthesizing: boolean;
  isSynthesisComplete: boolean;
  synthesisText: string;
  synthesisError: string | null;
  synthesisSources: SynthesisSource[];
  synthesisValidation: SynthesisValidation | null;
  copyLabel: string;
  selectedCompareCount: number;
  isComparing: boolean;
  resultsLength: number;
  onGenerateSynthesis: () => void;
  onCancelSynthesis: () => void;
  onGenerateComparison: () => void;
  onCopySynthesis: () => void;
};

export default function SynthesisPanel({
  activeQuery,
  isSynthesizing,
  isSynthesisComplete,
  synthesisText,
  synthesisError,
  synthesisSources,
  synthesisValidation,
  copyLabel,
  selectedCompareCount,
  isComparing,
  resultsLength,
  onGenerateSynthesis,
  onCancelSynthesis,
  onGenerateComparison,
  onCopySynthesis,
}: SynthesisPanelProps) {
  const paperCountUsed = Math.min(resultsLength, 5);

  return (
    <section
      className="rounded-xl border border-[#1d3658] bg-[#0c1a2e] p-5 sm:p-6 shadow-md transition-all"
      aria-label="Research synthesis workbench"
    >
      {/* Header & Primary Action Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#1d3658]">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs font-semibold text-cyan-400">
              Topic Synthesis
            </span>
            <span className="text-[#607899]" aria-hidden="true">·</span>
            <span className="text-xs text-[#9cb3cf]">
              Abstracts from top {paperCountUsed} retrieved papers
            </span>
          </div>

          <h3 className="text-base sm:text-lg font-bold tracking-tight text-[#f0f5fc]">
            Synthesis:{" "}
            <span className="text-cyan-300 font-semibold">
              &ldquo;{activeQuery}&rdquo;
            </span>
          </h3>
          <p className="text-xs text-[#9cb3cf]">
            Synthesises the top {paperCountUsed} results using Groq · abstract-based only
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap self-start lg:self-center">
          {isSynthesizing && (
            <button
              type="button"
              onClick={onCancelSynthesis}
              className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
            >
              Cancel
            </button>
          )}

          <button
            type="button"
            onClick={onGenerateSynthesis}
            disabled={isSynthesizing}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2 text-xs font-bold text-[#04121e] transition-colors hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            aria-label={
              isSynthesizing ? "Generating synthesis…" : "Generate topic synthesis"
            }
          >
            {isSynthesizing ? (
              <>
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#04121e] border-t-transparent" />
                <span>Generating…</span>
              </>
            ) : (
              <>
                <span aria-hidden="true">✦</span>
                <span>Generate Synthesis</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => onGenerateComparison()}
            disabled={isComparing || resultsLength < 2}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
              selectedCompareCount >= 2
                ? "border border-cyan-400/40 bg-cyan-500/15 text-cyan-300"
                : "border border-[#1d3658] bg-[#11233d] text-[#9cb3cf] hover:border-[#2b4f7c] hover:text-[#f0f5fc]"
            }`}
            aria-label="Compare selected papers"
          >
            <span aria-hidden="true">⇄</span>
            <span>
              {isComparing
                ? "Comparing…"
                : selectedCompareCount >= 2
                ? `Compare (${selectedCompareCount})`
                : "Compare Top 3"}
            </span>
          </button>
        </div>
      </div>

      {/* Synthesis Error Alert */}
      {synthesisError && (
        <div
          className="my-3.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs font-medium text-rose-300"
          role="alert"
        >
          {synthesisError}
        </div>
      )}

      {/* Streaming / Completed Synthesis Output Area */}
      {(synthesisText || isSynthesizing) && (
        <div className="mt-4 rounded-lg border border-[#1d3658] bg-[#071526] p-4 sm:p-5">
          <div className="synthesis-prose text-xs sm:text-sm leading-relaxed text-[#f0f5fc]">
            <ReactMarkdown
              components={{
                p: ({ children }) => {
                  return (
                    <p>
                      {React.Children.map(children, (child) => {
                        if (typeof child !== "string") return child;
                        const parts = child.split(/(\[SOURCE\s+\d+\])/g);
                        if (parts.length === 1) return child;
                        return parts.map((part, idx) => {
                          const match = part.match(/^\[SOURCE\s+(\d+)\]$/);
                          if (match) {
                            const num = match[1];
                            return (
                              <a
                                key={idx}
                                href={`#source-${num}`}
                                className="inline-flex items-center px-1.5 py-0.5 mx-0.5 text-[11px] font-mono font-semibold rounded bg-cyan-500/15 text-cyan-300 border border-cyan-400/30 transition-colors hover:bg-cyan-500/25 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
                                title={`Jump to Grounding Source ${num}`}
                                aria-label={`Grounding reference: [SOURCE ${num}]`}
                              >
                                {part}
                              </a>
                            );
                          }
                          return part;
                        });
                      })}
                    </p>
                  );
                },
              }}
            >
              {synthesisText}
            </ReactMarkdown>

            {isSynthesizing && (
              <span
                className="ml-1 inline-block h-3.5 w-1 animate-pulse rounded-sm bg-cyan-400 align-middle"
                aria-label="Generating…"
              />
            )}
          </div>
        </div>
      )}

      {/* Grounding Sources Matrix List */}
      {synthesisSources.length > 0 && (synthesisText || isSynthesizing) && (
        <div className="mt-4 rounded-lg border border-[#1d3658] bg-[#071526] p-4 text-xs">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#1d3658] pb-2.5">
            <span className="font-mono text-xs font-bold text-cyan-400">
              Grounding Sources ({synthesisSources.length} retrieved papers)
            </span>

            {isSynthesisComplete && synthesisValidation && (
              synthesisValidation.has_hallucinations ? (
                <span className="rounded border border-rose-500/40 bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-rose-300">
                  ⚠ Unverified Citations: [SOURCE {synthesisValidation.invalid_citations.join(", ")}]
                </span>
              ) : (
                <span className="rounded border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400">
                  ✓ Citations Verified ({synthesisValidation.cited_sources.length} sources cited)
                </span>
              )
            )}
          </div>

          <ol
            className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
            aria-label="Grounding sources"
          >
            {synthesisSources.map((source) => {
              const isCited = synthesisValidation?.cited_sources.includes(source.source_index);
              return (
                <li
                  key={source.arxiv_id}
                  id={`source-${source.source_index}`}
                  className={`flex flex-col justify-between rounded-lg p-3 transition-colors list-none border scroll-mt-20 ${
                    isCited
                      ? "border-cyan-500/40 bg-cyan-500/5"
                      : "border-[#1d3658] bg-[#0c1a2e]"
                  }`}
                >
                  <div>
                    <div className="mb-1.5 flex items-start justify-between gap-2">
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                          isCited
                            ? "bg-cyan-400 text-[#04121e]"
                            : "bg-[#11233d] text-[#9cb3cf] border border-[#1d3658]"
                        }`}
                      >
                        SOURCE {source.source_index}
                      </span>
                      {isCited && (
                        <span className="text-[11px] font-medium text-cyan-400">
                          ✓ Cited
                        </span>
                      )}
                    </div>
                    <a
                      href={source.entry_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="line-clamp-2 font-medium text-xs text-[#f0f5fc] hover:text-cyan-300 hover:underline leading-snug"
                    >
                      {source.title}
                    </a>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between text-[11px] border-t border-[#1d3658] pt-2 text-[#9cb3cf]">
                    <span className="truncate max-w-[160px]">
                      {source.authors.length > 0
                        ? `${source.authors[0]}${source.authors.length > 1 ? " et al." : ""}`
                        : source.arxiv_id}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={`#paper-${source.arxiv_id}`}
                        className="font-medium text-[#9cb3cf] hover:text-cyan-300 hover:underline transition-colors"
                        aria-label={`Jump to ${source.title} in results`}
                      >
                        Jump ↓
                      </a>
                      <a
                        href={source.entry_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[10px] text-cyan-400 hover:underline"
                        aria-label={`Open arXiv abstract for ${source.title}`}
                      >
                        arXiv ↗
                      </a>
                      {source.pdf_url && (
                        <a
                          href={source.pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[10px] text-cyan-300 hover:underline"
                          aria-label={`Open PDF for ${source.title}`}
                        >
                          PDF ↗
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          <p className="mt-2.5 text-[11px] text-[#607899]">
            ⚠ Grounding: Citations are cross-referenced directly against the retrieved candidate papers.
          </p>
        </div>
      )}

      {/* Completion Footer */}
      {isSynthesisComplete && synthesisText && (
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#1d3658]">
          <p className="text-xs text-[#607899]">
            Generated from author abstracts only — verify claims in original papers.
          </p>
          <button
            type="button"
            onClick={onCopySynthesis}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#1d3658] bg-[#11233d] px-3 py-1.5 text-xs font-medium text-[#f0f5fc] transition-colors hover:border-cyan-500/40 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            aria-label="Copy synthesis to clipboard"
          >
            <span aria-hidden="true">📋</span>
            <span>{copyLabel}</span>
          </button>
        </div>
      )}
    </section>
  );
}
