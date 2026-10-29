"use client";

import React from "react";

export type ComparisonPaper = {
  arxiv_id: string;
  title: string;
  entry_url: string;
  pdf_url?: string;
  published: string;
  authors: string[];
  research_question: string;
  method: string;
  datasets_or_setup: string;
  reported_findings: string;
  limitations: string;
};

export type ComparisonResult = {
  papers: ComparisonPaper[];
  similarities: string[];
  differences: string[];
  research_gaps: string[];
  disclaimer: string;
};

export type ComparisonMatrixProps = {
  isComparing: boolean;
  comparisonError: string | null;
  comparisonResult: ComparisonResult | null;
  onClose: () => void;
  onRetry: () => void;
};

export default function ComparisonMatrix({
  isComparing,
  comparisonError,
  comparisonResult,
  onClose,
  onRetry,
}: ComparisonMatrixProps) {
  return (
    <div
      className="mb-6 rounded-2xl p-5 sm:p-6 transition-all shadow-lg"
      style={{
        border: "1px solid var(--border-default)",
        backgroundColor: "var(--bg-surface)",
      }}
      aria-label="Comparative analysis matrix"
    >
      <div
        className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-4"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div>
          <h3
            className="text-lg font-bold sm:text-xl"
            style={{ color: "var(--text-primary)" }}
          >
            Comparative Analysis Matrix
          </h3>
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            Structured dimensional comparison extracted from author-reported abstracts
          </p>
        </div>
        <div className="flex items-center gap-2">
          {comparisonResult && (
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={{
                backgroundColor: "rgba(6,182,212,0.15)",
                color: "var(--text-accent)",
                border: "1px solid rgba(6,182,212,0.3)",
              }}
            >
              {comparisonResult.papers.length} Papers Compared
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            style={{
              backgroundColor: "var(--bg-elevated)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-subtle)",
            }}
            aria-label="Close comparison matrix"
          >
            ✕ Close
          </button>
        </div>
      </div>

      {/* Loading state */}
      {isComparing && (
        <div className="py-8 text-center" role="status" aria-live="polite">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          <p
            className="mt-3 text-sm font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            Extracting comparative matrix from selected papers…
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Analyzing research objectives, methodologies, reported findings, and limitations using Llama 3.1 8B Instant.
          </p>
        </div>
      )}

      {/* Error state */}
      {comparisonError && !isComparing && (
        <div
          className="rounded-xl p-4 text-sm"
          style={{
            border: "1px solid var(--error-border)",
            backgroundColor: "var(--error-bg)",
            color: "#fda4af",
          }}
          role="alert"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>{comparisonError}</p>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg px-3 py-1.5 text-xs font-bold transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
              style={{ backgroundColor: "#991b1b", color: "#fef2f2" }}
            >
              Retry Comparison
            </button>
          </div>
        </div>
      )}

      {/* Comparison Content */}
      {comparisonResult && !isComparing && (
        <div className="space-y-6">
          {/* Dimensional Comparison Table */}
          <div
            className="overflow-x-auto rounded-xl"
            style={{
              border: "1px solid var(--border-subtle)",
              backgroundColor: "var(--bg-page)",
            }}
          >
            <table className="w-full min-w-[700px] border-collapse text-left text-xs">
              <thead>
                <tr
                  style={{
                    backgroundColor: "var(--bg-elevated)",
                    borderBottom: "1px solid var(--border-subtle)",
                  }}
                >
                  <th
                    className="w-36 p-3 font-semibold uppercase tracking-wider"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Dimension
                  </th>
                  {comparisonResult.papers.map((p, idx) => (
                    <th
                      key={p.arxiv_id}
                      className="p-3 font-semibold"
                      style={{
                        color: "var(--text-primary)",
                        borderLeft:
                          idx > 0 ? "1px solid var(--border-subtle)" : undefined,
                      }}
                    >
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <a
                            href={p.entry_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[11px] font-bold hover:underline"
                            style={{ color: "var(--text-accent)" }}
                          >
                            arXiv:{p.arxiv_id}
                          </a>
                          {p.pdf_url && (
                            <a
                              href={p.pdf_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded px-1.5 py-0.5 text-[10px] font-medium hover:underline"
                              style={{
                                backgroundColor: "rgba(6,182,212,0.12)",
                                color: "var(--text-accent)",
                              }}
                            >
                              PDF ↗
                            </a>
                          )}
                        </div>
                        <a
                          href={p.entry_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="line-clamp-2 font-semibold text-xs leading-snug hover:underline"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {p.title}
                        </a>
                        <span
                          className="text-[10px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {p.published ? p.published.slice(0, 4) : ""} ·{" "}
                          {p.authors.length > 0
                            ? `${p.authors[0]} et al.`
                            : ""}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Row 1: Objective */}
                <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td
                    className="p-3 font-semibold align-top"
                    style={{
                      color: "var(--text-secondary)",
                      backgroundColor: "rgba(0,0,0,0.1)",
                    }}
                  >
                    Objective
                  </td>
                  {comparisonResult.papers.map((p, idx) => (
                    <td
                      key={p.arxiv_id}
                      className="p-3 leading-relaxed align-top"
                      style={{
                        color: "var(--text-primary)",
                        borderLeft:
                          idx > 0 ? "1px solid var(--border-subtle)" : undefined,
                      }}
                    >
                      {p.research_question}
                    </td>
                  ))}
                </tr>

                {/* Row 2: Method */}
                <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td
                    className="p-3 font-semibold align-top"
                    style={{
                      color: "var(--text-secondary)",
                      backgroundColor: "rgba(0,0,0,0.1)",
                    }}
                  >
                    Proposed Method
                  </td>
                  {comparisonResult.papers.map((p, idx) => (
                    <td
                      key={p.arxiv_id}
                      className="p-3 leading-relaxed align-top"
                      style={{
                        color: "var(--text-primary)",
                        borderLeft:
                          idx > 0 ? "1px solid var(--border-subtle)" : undefined,
                      }}
                    >
                      {p.method}
                    </td>
                  ))}
                </tr>

                {/* Row 3: Datasets & Setup */}
                <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td
                    className="p-3 font-semibold align-top"
                    style={{
                      color: "var(--text-secondary)",
                      backgroundColor: "rgba(0,0,0,0.1)",
                    }}
                  >
                    Datasets / Setup
                  </td>
                  {comparisonResult.papers.map((p, idx) => (
                    <td
                      key={p.arxiv_id}
                      className="p-3 leading-relaxed align-top"
                      style={{
                        color: p.datasets_or_setup.includes("Not explicitly")
                          ? "var(--text-muted)"
                          : "var(--text-primary)",
                        borderLeft:
                          idx > 0 ? "1px solid var(--border-subtle)" : undefined,
                      }}
                    >
                      {p.datasets_or_setup}
                    </td>
                  ))}
                </tr>

                {/* Row 4: Findings */}
                <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td
                    className="p-3 font-semibold align-top"
                    style={{
                      color: "var(--text-secondary)",
                      backgroundColor: "rgba(0,0,0,0.1)",
                    }}
                  >
                    Reported Findings
                  </td>
                  {comparisonResult.papers.map((p, idx) => (
                    <td
                      key={p.arxiv_id}
                      className="p-3 leading-relaxed align-top"
                      style={{
                        color: "var(--text-primary)",
                        borderLeft:
                          idx > 0 ? "1px solid var(--border-subtle)" : undefined,
                      }}
                    >
                      {p.reported_findings}
                    </td>
                  ))}
                </tr>

                {/* Row 5: Limitations */}
                <tr>
                  <td
                    className="p-3 font-semibold align-top"
                    style={{
                      color: "var(--text-secondary)",
                      backgroundColor: "rgba(0,0,0,0.1)",
                    }}
                  >
                    Author Limitations
                  </td>
                  {comparisonResult.papers.map((p, idx) => (
                    <td
                      key={p.arxiv_id}
                      className="p-3 leading-relaxed align-top"
                      style={{
                        color: p.limitations.includes("Not explicitly")
                          ? "var(--text-muted)"
                          : "#f87171",
                        borderLeft:
                          idx > 0 ? "1px solid var(--border-subtle)" : undefined,
                      }}
                    >
                      {p.limitations}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Cross-Paper Synthesized Insights */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {/* Similarities */}
            <div
              className="rounded-xl p-4"
              style={{
                backgroundColor: "var(--bg-page)",
                border: "1px solid rgba(6,182,212,0.25)",
              }}
            >
              <h4
                className="mb-2 text-xs font-bold uppercase tracking-wider"
                style={{ color: "var(--text-accent)" }}
              >
                Similarities & Consensus
              </h4>
              <ul
                className="space-y-1.5 text-xs"
                style={{ color: "var(--text-secondary)" }}
              >
                {comparisonResult.similarities.length > 0 ? (
                  comparisonResult.similarities.map((item, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span style={{ color: "var(--text-accent)" }}>•</span>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li
                    className="text-[11px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    No notable commonalities identified in abstracts.
                  </li>
                )}
              </ul>
            </div>

            {/* Differences */}
            <div
              className="rounded-xl p-4"
              style={{
                backgroundColor: "var(--bg-page)",
                border: "1px solid rgba(99,102,241,0.25)",
              }}
            >
              <h4
                className="mb-2 text-xs font-bold uppercase tracking-wider"
                style={{ color: "#818cf8" }}
              >
                Methodological Differences
              </h4>
              <ul
                className="space-y-1.5 text-xs"
                style={{ color: "var(--text-secondary)" }}
              >
                {comparisonResult.differences.length > 0 ? (
                  comparisonResult.differences.map((item, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span style={{ color: "#818cf8" }}>•</span>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li
                    className="text-[11px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    No distinct divergence reported across abstracts.
                  </li>
                )}
              </ul>
            </div>

            {/* Research Gaps */}
            <div
              className="rounded-xl p-4"
              style={{
                backgroundColor: "var(--bg-page)",
                border: "1px solid rgba(245,158,11,0.25)",
              }}
            >
              <div className="mb-2 flex items-center justify-between gap-1">
                <h4
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: "#fbbf24" }}
                >
                  Potential Research Gaps
                </h4>
                <span
                  className="rounded px-1.5 py-0.5 text-[9px] font-medium"
                  style={{
                    backgroundColor: "rgba(245,158,11,0.15)",
                    color: "#fbbf24",
                  }}
                >
                  Model Interpretation
                </span>
              </div>
              <ul
                className="space-y-1.5 text-xs"
                style={{ color: "var(--text-secondary)" }}
              >
                {comparisonResult.research_gaps.length > 0 ? (
                  comparisonResult.research_gaps.map((item, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span style={{ color: "#fbbf24" }}>•</span>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li
                    className="text-[11px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    No evident research gaps derived from reported limitations.
                  </li>
                )}
              </ul>
            </div>
          </div>

          {/* Disclaimer */}
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            ⚠ {comparisonResult.disclaimer}
          </p>
        </div>
      )}
    </div>
  );
}
