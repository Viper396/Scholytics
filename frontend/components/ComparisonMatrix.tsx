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
      className="mb-8 rounded-2xl border border-[#1e385c] bg-[#0c1a2e] p-5 sm:p-7 shadow-2xl transition-all"
      aria-label="Comparative analysis matrix"
    >
      {/* Header bar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[#1e385c]/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
            <span className="text-base font-bold">⇄</span>
          </div>
          <div>
            <h3 className="text-lg sm:text-xl font-bold tracking-tight text-[#eaf2ff]">
              Comparative Analysis Matrix
            </h3>
            <p className="mt-0.5 text-xs text-[#9cb1ce]">
              Structured dimensional comparison extracted from author-reported abstracts
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {comparisonResult && (
            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 font-mono text-xs font-semibold text-cyan-400">
              {comparisonResult.papers.length} Papers Compared
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[#1e385c] bg-[#11223b] px-3 py-1.5 text-xs font-semibold text-[#9cb1ce] transition-all hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            aria-label="Close comparison matrix"
          >
            ✕ Close
          </button>
        </div>
      </div>

      {/* Loading State */}
      {isComparing && (
        <div className="py-12 text-center" role="status" aria-live="polite">
          <div className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          <p className="mt-3 text-sm font-semibold text-[#eaf2ff]">
            Extracting comparative matrix from selected papers…
          </p>
          <p className="mt-1 text-xs text-[#5e779a]">
            Analyzing research objectives, methodologies, reported findings, and limitations using Llama 3.1 8B Instant.
          </p>
        </div>
      )}

      {/* Error State */}
      {comparisonError && !isComparing && (
        <div
          className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs font-medium text-rose-300"
          role="alert"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="leading-relaxed">{comparisonError}</p>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg bg-rose-700 hover:bg-rose-600 px-3 py-1.5 text-xs font-bold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
            >
              Retry Comparison
            </button>
          </div>
        </div>
      )}

      {/* Comparison Results Table */}
      {comparisonResult && !isComparing && (
        <div className="space-y-6">
          {/* Dimensional Comparison Table */}
          <div className="overflow-x-auto rounded-xl border border-[#1e385c]/80 bg-[#081526]">
            <table className="w-full min-w-[760px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#1e385c] bg-[#11223b]">
                  <th className="w-40 p-4 font-mono text-[11px] font-bold uppercase tracking-wider text-cyan-400">
                    Dimension
                  </th>
                  {comparisonResult.papers.map((p, idx) => (
                    <th
                      key={p.arxiv_id}
                      className={`p-4 font-semibold text-[#eaf2ff] ${
                        idx > 0 ? "border-l border-[#1e385c]" : ""
                      }`}
                      style={{ width: `${Math.floor(100 / (comparisonResult.papers.length + 1))}%` }}
                    >
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <a
                            href={p.entry_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[11px] font-bold text-cyan-400 hover:underline"
                          >
                            arXiv:{p.arxiv_id}
                          </a>
                          {p.pdf_url && (
                            <a
                              href={p.pdf_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded border border-cyan-500/30 bg-cyan-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-300 hover:bg-cyan-500/25"
                            >
                              PDF ↗
                            </a>
                          )}
                        </div>
                        <a
                          href={p.entry_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="line-clamp-2 font-semibold text-xs leading-snug text-[#eaf2ff] hover:text-cyan-300 hover:underline"
                        >
                          {p.title}
                        </a>
                        <span className="text-[11px] text-[#5e779a]">
                          {p.published ? p.published.slice(0, 4) : ""} ·{" "}
                          {p.authors.length > 0 ? `${p.authors[0]} et al.` : ""}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e385c]/60">
                {/* Row 1: Objective */}
                <tr className="hover:bg-[#0c1a2e]/50 transition-colors">
                  <td className="p-4 font-mono text-[11px] font-semibold text-cyan-300/80 bg-[#11223b]/40 align-top">
                    Objective
                  </td>
                  {comparisonResult.papers.map((p, idx) => (
                    <td
                      key={p.arxiv_id}
                      className={`p-4 leading-relaxed text-[#eaf2ff] align-top ${
                        idx > 0 ? "border-l border-[#1e385c]/60" : ""
                      }`}
                    >
                      {p.research_question}
                    </td>
                  ))}
                </tr>

                {/* Row 2: Method */}
                <tr className="hover:bg-[#0c1a2e]/50 transition-colors">
                  <td className="p-4 font-mono text-[11px] font-semibold text-cyan-300/80 bg-[#11223b]/40 align-top">
                    Proposed Method
                  </td>
                  {comparisonResult.papers.map((p, idx) => (
                    <td
                      key={p.arxiv_id}
                      className={`p-4 leading-relaxed text-[#eaf2ff] align-top ${
                        idx > 0 ? "border-l border-[#1e385c]/60" : ""
                      }`}
                    >
                      {p.method}
                    </td>
                  ))}
                </tr>

                {/* Row 3: Datasets & Setup */}
                <tr className="hover:bg-[#0c1a2e]/50 transition-colors">
                  <td className="p-4 font-mono text-[11px] font-semibold text-cyan-300/80 bg-[#11223b]/40 align-top">
                    Datasets / Setup
                  </td>
                  {comparisonResult.papers.map((p, idx) => (
                    <td
                      key={p.arxiv_id}
                      className={`p-4 leading-relaxed align-top ${
                        idx > 0 ? "border-l border-[#1e385c]/60" : ""
                      } ${
                        p.datasets_or_setup.includes("Not explicitly")
                          ? "text-[#5e779a] italic"
                          : "text-[#eaf2ff]"
                      }`}
                    >
                      {p.datasets_or_setup}
                    </td>
                  ))}
                </tr>

                {/* Row 4: Findings */}
                <tr className="hover:bg-[#0c1a2e]/50 transition-colors">
                  <td className="p-4 font-mono text-[11px] font-semibold text-cyan-300/80 bg-[#11223b]/40 align-top">
                    Reported Findings
                  </td>
                  {comparisonResult.papers.map((p, idx) => (
                    <td
                      key={p.arxiv_id}
                      className={`p-4 leading-relaxed text-[#eaf2ff] align-top ${
                        idx > 0 ? "border-l border-[#1e385c]/60" : ""
                      }`}
                    >
                      {p.reported_findings}
                    </td>
                  ))}
                </tr>

                {/* Row 5: Limitations */}
                <tr className="hover:bg-[#0c1a2e]/50 transition-colors">
                  <td className="p-4 font-mono text-[11px] font-semibold text-cyan-300/80 bg-[#11223b]/40 align-top">
                    Author Limitations
                  </td>
                  {comparisonResult.papers.map((p, idx) => (
                    <td
                      key={p.arxiv_id}
                      className={`p-4 leading-relaxed align-top ${
                        idx > 0 ? "border-l border-[#1e385c]/60" : ""
                      } ${
                        p.limitations.includes("Not explicitly")
                          ? "text-[#5e779a] italic"
                          : "text-rose-300"
                      }`}
                    >
                      {p.limitations}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Cross-Paper Synthesized Insights */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Similarities */}
            <div className="rounded-xl border border-cyan-500/30 bg-[#081526] p-4 sm:p-5">
              <div className="mb-2.5 flex items-center gap-1.5">
                <span className="text-cyan-400 font-bold">✓</span>
                <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-400">
                  Similarities & Consensus
                </h4>
              </div>
              <ul className="space-y-2 text-xs text-[#9cb1ce]">
                {comparisonResult.similarities.length > 0 ? (
                  comparisonResult.similarities.map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-cyan-400 font-bold mt-0.5">•</span>
                      <span className="leading-relaxed">{item}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-[11px] text-[#5e779a] italic">
                    No notable commonalities identified in abstracts.
                  </li>
                )}
              </ul>
            </div>

            {/* Differences */}
            <div className="rounded-xl border border-indigo-500/30 bg-[#081526] p-4 sm:p-5">
              <div className="mb-2.5 flex items-center gap-1.5">
                <span className="text-indigo-400 font-bold">≠</span>
                <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-indigo-400">
                  Methodological Differences
                </h4>
              </div>
              <ul className="space-y-2 text-xs text-[#9cb1ce]">
                {comparisonResult.differences.length > 0 ? (
                  comparisonResult.differences.map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-indigo-400 font-bold mt-0.5">•</span>
                      <span className="leading-relaxed">{item}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-[11px] text-[#5e779a] italic">
                    No distinct divergence reported across abstracts.
                  </li>
                )}
              </ul>
            </div>

            {/* Research Gaps */}
            <div className="rounded-xl border border-amber-500/30 bg-[#081526] p-4 sm:p-5">
              <div className="mb-2.5 flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-amber-400 font-bold">?</span>
                  <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-amber-400">
                    Potential Research Gaps
                  </h4>
                </div>
                <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-amber-400">
                  Model Interpretation
                </span>
              </div>
              <ul className="space-y-2 text-xs text-[#9cb1ce]">
                {comparisonResult.research_gaps.length > 0 ? (
                  comparisonResult.research_gaps.map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-amber-400 font-bold mt-0.5">•</span>
                      <span className="leading-relaxed">{item}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-[11px] text-[#5e779a] italic">
                    No evident research gaps derived from reported limitations.
                  </li>
                )}
              </ul>
            </div>
          </div>

          {/* Disclaimer */}
          <p className="text-[11px] text-[#5e779a]">
            ⚠ {comparisonResult.disclaimer}
          </p>
        </div>
      )}
    </div>
  );
}
