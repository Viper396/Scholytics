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
  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-[#1e385c] bg-[#0c1a2e] p-5 sm:p-7 shadow-xl transition-all"
      aria-label="Research synthesis workbench"
    >
      {/* Top Ambient Glow Edge */}
      <div className="absolute left-0 right-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-80" />

      {/* Header & Primary Action Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-[#1e385c]/80">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="flex h-5 items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-cyan-400 uppercase">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
              Live Semantic Synthesis
            </span>
            <span className="rounded-md border border-[#1e385c] bg-[#11223b] px-2 py-0.5 font-mono text-[10px] text-[#9cb1ce]">
              Top {Math.min(resultsLength, 5)} Papers
            </span>
          </div>

          <h3 className="text-lg sm:text-xl font-bold tracking-tight text-[#eaf2ff] leading-snug">
            What does research say about{" "}
            <em className="text-cyan-400 not-italic font-semibold">
              {activeQuery}
            </em>
            ?
          </h3>
          <p className="text-xs text-[#9cb1ce]">
            Synthesises the top {Math.min(resultsLength, 5)} results using Groq · abstract-based only
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5 flex-wrap self-start lg:self-center">
          {isSynthesizing && (
            <button
              type="button"
              onClick={onCancelSynthesis}
              className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-4 py-2 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
            >
              Cancel
            </button>
          )}

          <button
            type="button"
            onClick={onGenerateSynthesis}
            disabled={isSynthesizing}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-500 px-5 py-2 text-xs font-bold text-[#04121e] shadow-[0_0_16px_rgba(34,211,238,0.25)] transition-all hover:from-cyan-300 hover:to-cyan-400 hover:shadow-[0_0_24px_rgba(34,211,238,0.4)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
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
            className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
              selectedCompareCount >= 2
                ? "border border-cyan-400/50 bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.2)]"
                : "border border-[#1e385c] bg-[#11223b] text-[#9cb1ce] hover:border-cyan-500/40 hover:text-[#eaf2ff]"
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
          className="my-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs font-medium text-rose-300"
          role="alert"
        >
          {synthesisError}
        </div>
      )}

      {/* Synthesis Output Area */}
      {(synthesisText || isSynthesizing) && (
        <div className="mt-5 rounded-xl border border-[#1e385c]/80 bg-[#081526] p-5 sm:p-6 shadow-inner">
          <div className="synthesis-prose text-sm leading-relaxed text-[#eaf2ff]">
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
                                className="inline-flex items-center px-1.5 py-0.5 mx-0.5 text-[11px] font-mono font-bold rounded bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 transition-all hover:scale-105 hover:bg-cyan-500/30 hover:underline focus:outline-none focus:ring-2 focus:ring-cyan-400"
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
                className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-cyan-400 align-middle"
                aria-label="Generating…"
              />
            )}
          </div>
        </div>
      )}

      {/* Grounding Sources Matrix List */}
      {synthesisSources.length > 0 && (synthesisText || isSynthesizing) && (
        <div className="mt-5 rounded-xl border border-[#1e385c]/80 bg-[#081526] p-4 sm:p-5 text-xs">
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2 border-b border-[#1e385c]/60 pb-3">
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-cyan-400">
              Grounding Sources ({synthesisSources.length} retrieved papers)
            </span>

            {isSynthesisComplete && synthesisValidation && (
              synthesisValidation.has_hallucinations ? (
                <span className="rounded-full border border-rose-500/40 bg-rose-500/15 px-2.5 py-0.5 text-xs font-semibold text-rose-300">
                  ⚠ Unverified Citations: [SOURCE {synthesisValidation.invalid_citations.join(", ")}]
                </span>
              ) : (
                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
                  ✓ Citations Verified ({synthesisValidation.cited_sources.length} sources cited)
                </span>
              )
            )}
          </div>

          <ol
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            aria-label="Grounding sources"
          >
            {synthesisSources.map((source) => {
              const isCited = synthesisValidation?.cited_sources.includes(source.source_index);
              return (
                <li
                  key={source.arxiv_id}
                  id={`source-${source.source_index}`}
                  className={`flex flex-col justify-between rounded-xl p-3.5 transition-all list-none border ${
                    isCited
                      ? "border-cyan-500/40 bg-cyan-500/5 shadow-[0_0_12px_rgba(34,211,238,0.06)]"
                      : "border-[#1e385c] bg-[#0c1a2e]"
                  }`}
                >
                  <div>
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                          isCited
                            ? "bg-cyan-400 text-[#04121e]"
                            : "bg-[#11223b] text-[#9cb1ce] border border-[#1e385c]"
                        }`}
                      >
                        SOURCE {source.source_index}
                      </span>
                      {isCited && (
                        <span className="text-[10px] font-semibold text-cyan-400">
                          ✓ Cited
                        </span>
                      )}
                    </div>
                    <a
                      href={source.entry_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="line-clamp-2 font-medium text-xs text-[#eaf2ff] hover:text-cyan-300 hover:underline leading-snug"
                    >
                      {source.title}
                    </a>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-[11px] border-t border-[#1e385c]/60 pt-2 text-[#9cb1ce]">
                    <span className="truncate max-w-[150px]">
                      {source.authors.length > 0
                        ? `${source.authors[0]}${source.authors.length > 1 ? " et al." : ""}`
                        : source.arxiv_id}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={`#paper-${source.arxiv_id}`}
                        className="font-medium text-[#9cb1ce] hover:text-cyan-300 hover:underline transition-colors"
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

          <p className="mt-3 text-[11px] text-[#5e779a]">
            ⚠ Grounding Guarantee: Citations are cross-referenced against the retrieved candidate papers.
            Does not perform automated laboratory fact verification.
          </p>
        </div>
      )}

      {/* Completion Footer */}
      {isSynthesisComplete && synthesisText && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3.5 border-t border-[#1e385c]/80">
          <p className="text-xs text-[#5e779a]">
            ⚠ Generated from abstracts only — verify claims in original papers.
          </p>
          <button
            type="button"
            onClick={onCopySynthesis}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e385c] bg-[#11223b] px-3.5 py-1.5 text-xs font-semibold text-[#eaf2ff] transition-all hover:border-cyan-500/40 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            aria-label="Copy synthesis to clipboard"
          >
            <span>📋</span>
            <span>{copyLabel}</span>
          </button>
        </div>
      )}
    </section>
  );
}
