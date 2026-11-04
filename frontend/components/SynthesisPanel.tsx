"use client";

import React, { useState } from "react";
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
  selectedCompareCount?: number;
  isComparing?: boolean;
  resultsLength: number;
  onGenerateSynthesis: () => void;
  onCancelSynthesis: () => void;
  onGenerateComparison?: () => void;
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
  selectedCompareCount = 0,
  isComparing = false,
  resultsLength,
  onGenerateSynthesis,
  onCancelSynthesis,
  onGenerateComparison,
  onCopySynthesis,
}: SynthesisPanelProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const paperCountUsed = Math.min(resultsLength, 5);

  return (
    <div
      className="rounded-xl border border-[#294058] bg-[#101e30] p-5 shadow-sm transition-all flex flex-col gap-3.5"
      aria-label="Research synthesis"
    >
      {/* Header */}
      <div>
        <h3 className="text-lg font-bold tracking-tight text-[#eaf2f8]">
          Research synthesis
        </h3>
        <p className="text-xs text-[#a7bacd] mt-0.5">
          Based on the top {paperCountUsed} abstracts
        </p>
      </div>

      {/* Synthesis Error Alert */}
      {synthesisError && (
        <div
          className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-xs font-medium text-rose-300"
          role="alert"
        >
          {synthesisError}
        </div>
      )}

      {/* Prompt invitation if empty and not synthesizing */}
      {!synthesisText && !isSynthesizing && !synthesisError && (
        <p className="text-xs text-[#a7bacd] leading-relaxed">
          Synthesize key findings, comparative methodology, and consensus across the top retrieved paper abstracts.
        </p>
      )}

      {/* Streaming or Completed Markdown Output Area */}
      {(synthesisText || isSynthesizing) && (
        <div className="synthesis-prose text-sm leading-relaxed text-[#eaf2f8] space-y-2">
          <ReactMarkdown
            components={{
              p: ({ children }) => {
                return (
                  <p className="text-sm leading-relaxed text-[#eaf2f8]">
                    {React.Children.map(children, (child) => {
                      if (typeof child !== "string") return child;
                      const parts = child.split(/(\[SOURCE\s+\d+\]|\[\d+\])/g);
                      if (parts.length === 1) return child;
                      return parts.map((part, idx) => {
                        const sourceMatch =
                          part.match(/^\[SOURCE\s+(\d+)\]$/) ||
                          part.match(/^\[(\d+)\]$/);
                        if (sourceMatch) {
                          const num = parseInt(sourceMatch[1], 10);
                          const sourceExists = synthesisSources.some(
                            (s) => s.source_index === num,
                          );
                          if (sourceExists) {
                            return (
                              <a
                                key={idx}
                                href={`#source-${num}`}
                                onClick={() => setSourcesOpen(true)}
                                className="inline-flex items-center px-1 mx-0.5 text-xs font-mono font-bold rounded bg-[#24c6d8]/15 text-[#24c6d8] hover:underline"
                                title={`Jump to Source ${num}`}
                                aria-label={`Grounding reference: [SOURCE ${num}]`}
                              >
                                [{num}]
                              </a>
                            );
                          }
                          return (
                            <span
                              key={idx}
                              className="inline-flex items-center px-1 mx-0.5 text-xs font-mono rounded bg-rose-500/10 text-rose-300 border border-rose-500/30"
                              title={`Unverified citation: ${part}`}
                            >
                              {part}
                            </span>
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
              className="ml-1 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-[#24c6d8] align-middle"
              aria-label="Generating…"
            />
          )}
        </div>
      )}

      {/* Sources Toggle Button */}
      {synthesisSources.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setSourcesOpen(!sourcesOpen)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#24c6d8] hover:text-[#3de0f2] hover:underline"
          >
            <span>
              {sourcesOpen ? "Hide" : "View"} {synthesisSources.length} sources
            </span>
            <span aria-hidden="true">{sourcesOpen ? "↑" : "→"}</span>
          </button>

          {/* Grounding Sources List */}
          <div
            className={`mt-3 space-y-2 rounded-lg border border-[#294058] bg-[#14263a] p-3 text-xs ${
              sourcesOpen ? "block" : "hidden sm:block"
            }`}
          >
            <div className="flex items-center justify-between pb-1.5 border-b border-[#294058]">
              <span className="font-mono text-xs font-bold text-[#24c6d8]">
                Grounding Sources ({synthesisSources.length} retrieved papers)
              </span>
              {synthesisValidation && (
                synthesisValidation.has_hallucinations ? (
                  <span className="text-[11px] font-semibold text-rose-300">
                    ⚠ Unverified Citations: [SOURCE {synthesisValidation.invalid_citations.join(", ")}]
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold text-emerald-400">
                    ✓ Citations Verified ({synthesisValidation.cited_sources.length} sources cited)
                  </span>
                )
              )}
            </div>

            <ol className="space-y-2">
              {synthesisSources.map((source) => {
                const isCited = synthesisValidation?.cited_sources.includes(source.source_index);
                return (
                  <li
                    key={source.arxiv_id}
                    id={`source-${source.source_index}`}
                    className="rounded border border-[#294058]/80 bg-[#101e30] p-2"
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <span className="rounded bg-[#14263a] px-1.5 py-0.2 font-mono text-[10px] font-bold text-[#24c6d8] border border-[#294058]">
                        [{source.source_index}]
                      </span>
                      <a
                        href={source.entry_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 font-medium text-[#eaf2f8] hover:text-[#24c6d8] hover:underline line-clamp-1"
                      >
                        {source.title}
                      </a>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-[#a7bacd]">
                      <span className="truncate max-w-[140px]">
                        {source.authors[0] || "Unknown"}
                      </span>
                      <div className="flex items-center gap-2 font-mono">
                        <a
                          href={`#paper-${source.arxiv_id}`}
                          className="text-[#a7bacd] hover:text-[#24c6d8] hover:underline"
                        >
                          Jump ↓
                        </a>
                        <a
                          href={source.entry_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#24c6d8] hover:underline"
                        >
                          arXiv ↗
                        </a>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}

      {/* Action Controls: Generate / Stop / Regenerate / Copy */}
      <div className="mt-1 flex items-center gap-2 pt-2 border-t border-[#294058]/60 flex-wrap">
        {isSynthesizing ? (
          <button
            type="button"
            onClick={onCancelSynthesis}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
            aria-label="Cancel and stop synthesis"
          >
            <span aria-hidden="true">■</span>
            <span>Stop</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onGenerateSynthesis}
            disabled={isSynthesizing || resultsLength === 0}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#24c6d8] px-4 py-2 text-xs font-bold text-[#07111d] transition-colors hover:bg-[#3de0f2] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#24c6d8]"
            aria-label="Generate topic synthesis"
          >
            <span>{synthesisText ? "Regenerate" : "Generate synthesis"}</span>
          </button>
        )}

        {isSynthesisComplete && synthesisText && (
          <button
            type="button"
            onClick={onCopySynthesis}
            className="inline-flex items-center gap-1 rounded-lg border border-[#294058] bg-[#14263a] px-3 py-2 text-xs font-semibold text-[#eaf2f8] transition-colors hover:border-[#24c6d8] hover:text-[#24c6d8]"
            aria-label="Copy synthesis to clipboard"
          >
            <svg className="h-3.5 w-3.5 text-[#a7bacd]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
            </svg>
            <span>{copyLabel}</span>
          </button>
        )}
      </div>
    </div>
  );
}
