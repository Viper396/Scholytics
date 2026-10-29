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
    <div
      className="rounded-[18px] p-5 sm:p-6 shadow-sm"
      style={{
        border: "1px solid var(--border-default)",
        backgroundColor: "var(--bg-surface)",
      }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3
            className="text-lg font-semibold sm:text-xl"
            style={{ color: "var(--text-primary)" }}
          >
            What does research say about{" "}
            <em style={{ color: "var(--text-accent)", fontStyle: "normal" }}>
              {activeQuery}
            </em>
            ?
          </h3>
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            Synthesises the top {Math.min(resultsLength, 5)} results using Groq · abstract-based only
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSynthesizing && (
            <button
              type="button"
              onClick={onCancelSynthesis}
              className="rounded-xl px-4 py-2 text-sm font-semibold transition-colors hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
              style={{
                border: "1px solid var(--border-default)",
                backgroundColor: "var(--bg-elevated)",
                color: "var(--text-secondary)",
              }}
            >
              Cancel
            </button>
          )}

          <button
            type="button"
            onClick={onGenerateSynthesis}
            disabled={isSynthesizing}
            className="rounded-xl px-4 py-2 text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            style={{
              backgroundColor: "var(--cyan-primary)",
              color: "var(--cyan-text)",
            }}
            onMouseEnter={(e) => {
              if (!isSynthesizing)
                e.currentTarget.style.backgroundColor = "var(--cyan-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--cyan-primary)";
            }}
            aria-label={
              isSynthesizing ? "Generating synthesis…" : "Generate topic synthesis"
            }
          >
            {isSynthesizing ? "Generating…" : "Generate Synthesis"}
          </button>

          <button
            type="button"
            onClick={() => onGenerateComparison()}
            disabled={isComparing || resultsLength < 2}
            className="rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            style={
              selectedCompareCount >= 2
                ? {
                    backgroundColor: "rgba(6,182,212,0.18)",
                    border: "1px solid rgba(6,182,212,0.45)",
                    color: "var(--text-accent)",
                  }
                : {
                    border: "1px solid var(--border-default)",
                    backgroundColor: "var(--bg-elevated)",
                    color: "var(--text-secondary)",
                  }
            }
            aria-label="Compare selected papers"
          >
            {isComparing
              ? "Comparing…"
              : selectedCompareCount >= 2
              ? `Compare (${selectedCompareCount})`
              : "Compare Top 3"}
          </button>
        </div>
      </div>

      {/* Synthesis error alert */}
      {synthesisError && (
        <div
          className="mb-3 rounded-lg px-4 py-3 text-sm"
          style={{
            border: "1px solid var(--error-border)",
            backgroundColor: "var(--error-bg)",
            color: "#fda4af",
          }}
          role="alert"
        >
          {synthesisError}
        </div>
      )}

      {/* Generated text with interactive citations */}
      {(synthesisText || isSynthesizing) && (
        <div
          className="rounded-xl p-4 sm:p-5"
          style={{
            border: "1px solid var(--border-subtle)",
            backgroundColor: "var(--bg-page)",
          }}
        >
          <div className="synthesis-prose text-sm leading-relaxed">
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
                                className="inline-flex items-center px-1.5 py-0.5 mx-0.5 text-xs font-mono font-bold rounded transition-all hover:scale-105 hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--cyan-hover)]"
                                style={{
                                  backgroundColor: "var(--cyan-subtle)",
                                  color: "var(--text-accent)",
                                  border: "1px solid rgba(6,182,212,0.35)",
                                  textDecoration: "none",
                                }}
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
                className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-sm align-middle"
                style={{ backgroundColor: "var(--text-accent)" }}
                aria-label="Generating…"
              />
            )}
          </div>
        </div>
      )}

      {/* Grounding Sources list (accessible OL with navigable anchors) */}
      {synthesisSources.length > 0 && (synthesisText || isSynthesizing) && (
        <div
          className="mt-4 rounded-xl p-3.5 sm:p-4 text-xs"
          style={{
            border: "1px solid var(--border-subtle)",
            backgroundColor: "var(--bg-elevated)",
          }}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span
              className="font-semibold text-xs tracking-wider uppercase"
              style={{ color: "var(--text-secondary)" }}
            >
              Grounding Sources ({synthesisSources.length} retrieved papers)
            </span>

            {isSynthesisComplete && synthesisValidation && (
              synthesisValidation.has_hallucinations ? (
                <span
                  className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: "rgba(239,68,68,0.15)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    color: "#f87171",
                  }}
                >
                  ⚠ Unverified Citations: [SOURCE {synthesisValidation.invalid_citations.join(", ")}]
                </span>
              ) : (
                <span
                  className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: "rgba(16,185,129,0.15)",
                    border: "1px solid rgba(16,185,129,0.3)",
                    color: "#34d399",
                  }}
                >
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
                  className="flex flex-col justify-between rounded-lg p-3 transition-colors list-none"
                  style={{
                    border: isCited
                      ? "1px solid rgba(6,182,212,0.4)"
                      : "1px solid var(--border-subtle)",
                    backgroundColor: isCited
                      ? "rgba(6,182,212,0.06)"
                      : "var(--bg-page)",
                  }}
                >
                  <div>
                    <div className="mb-1.5 flex items-start justify-between gap-2">
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold"
                        style={{
                          backgroundColor: isCited
                            ? "var(--cyan-primary)"
                            : "var(--bg-elevated)",
                          color: isCited ? "#082f49" : "var(--text-secondary)",
                        }}
                      >
                        SOURCE {source.source_index}
                      </span>
                      {isCited && (
                        <span
                          className="text-[10px] font-semibold"
                          style={{ color: "var(--text-accent)" }}
                        >
                          ✓ Cited
                        </span>
                      )}
                    </div>
                    <a
                      href={source.entry_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="line-clamp-2 font-medium text-xs hover:underline"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {source.title}
                    </a>
                  </div>

                  <div
                    className="mt-3 flex items-center justify-between text-[11px] border-t pt-2"
                    style={{ borderColor: "rgba(255,255,255,0.05)", color: "var(--text-muted)" }}
                  >
                    <span>
                      {source.authors.length > 0
                        ? `${source.authors[0]}${source.authors.length > 1 ? " et al." : ""}`
                        : source.arxiv_id}
                    </span>
                    <div className="flex items-center gap-2">
                      <a
                        href={`#paper-${source.arxiv_id}`}
                        className="font-medium hover:underline transition-colors"
                        style={{ color: "var(--text-secondary)" }}
                        aria-label={`Jump to ${source.title} in results`}
                      >
                        Jump to paper ↓
                      </a>
                      <a
                        href={source.entry_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium hover:underline"
                        style={{ color: "var(--text-accent-dim)" }}
                        aria-label={`Open arXiv abstract for ${source.title}`}
                      >
                        arXiv ↗
                      </a>
                      {source.pdf_url && (
                        <a
                          href={source.pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium hover:underline"
                          style={{ color: "var(--text-accent)" }}
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

          <p className="mt-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
            ⚠ Grounding Guarantee: Citations are cross-referenced against the retrieved candidate papers.
            Does not perform automated laboratory fact verification.
          </p>
        </div>
      )}

      {/* Completion footer */}
      {isSynthesisComplete && synthesisText && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3 border-t" style={{ borderColor: "var(--border-subtle)" }}>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            ⚠ Generated from abstracts only — verify claims in original papers.
          </p>
          <button
            type="button"
            onClick={onCopySynthesis}
            className="rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            style={{
              border: "1px solid var(--border-default)",
              backgroundColor: "var(--bg-elevated)",
              color: "var(--text-secondary)",
            }}
            aria-label="Copy synthesis to clipboard"
          >
            {copyLabel}
          </button>
        </div>
      )}
    </div>
  );
}
