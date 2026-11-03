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
    <section
      className="mb-8 rounded-xl border border-[#1d3658] bg-[#0c1a2e] p-5 sm:p-6 shadow-lg transition-all"
      aria-label="Comparative analysis matrix"
    >
      {/* Header bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#1d3658] pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#1d3658] bg-[#11233d] text-cyan-400">
            <span className="text-sm font-bold" aria-hidden="true">⇄</span>
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-bold tracking-tight text-[#f0f5fc]">
              Comparative Analysis Matrix
            </h3>
            <p className="text-xs text-[#9cb3cf]">
              Dimensional comparison extracted from author-reported abstracts (2–4 papers)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {comparisonResult && (
            <span className="rounded border border-[#1d3658] bg-[#11233d] px-2.5 py-1 font-mono text-xs font-semibold text-cyan-400">
              {comparisonResult.papers.length} Papers Compared
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#1d3658] bg-[#11233d] px-3 py-1.5 text-xs font-medium text-[#9cb3cf] transition-colors hover:border-rose-500/40 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            aria-label="Close comparison matrix"
          >
            ✕ Close
          </button>
        </div>
      </div>

      {/* Loading State */}
      {isComparing && (
        <div className="py-10 text-center" role="status" aria-live="polite">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          <p className="mt-3 text-sm font-semibold text-[#f0f5fc]">
            Extracting comparative matrix from selected papers…
          </p>
          <p className="mt-1 text-xs text-[#607899]">
            Analyzing research objectives, methodologies, reported findings, and limitations.
          </p>
        </div>
      )}

      {/* Error State */}
      {comparisonError && !isComparing && (
        <div
          className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-xs font-medium text-rose-300"
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

      {/* Comparison Results */}
      {comparisonResult && !isComparing && (
        <div className="space-y-5">
          {/* Dimensional Comparison Table with Horizontal Scroll */}
          <div className="overflow-x-auto rounded-lg border border-[#1d3658] bg-[#071526]">
            <table className="w-full min-w-[700px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#1d3658] bg-[#11233d]">
                  <th className="w-36 p-3.5 font-mono text-[11px] font-bold text-cyan-400 uppercase tracking-wider sticky left-0 bg-[#11233d] z-10">
                    Dimension
                  </th>
                  {comparisonResult.papers.map((p, idx) => (
                    <th
                      key={p.arxiv_id}
                      className={`p-3.5 font-semibold text-[#f0f5fc] ${
                        idx > 0 ? "border-l border-[#1d3658]" : ""
                      }`}
                      style={{ width: `${Math.floor(100 / (comparisonResult.papers.length + 1))}%` }}
                    >
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-2">
                          <a
                            href={p.entry_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[11px] font-semibold text-cyan-400 hover:underline"
                          >
                            arXiv:{p.arxiv_id}
                          </a>
                          {p.pdf_url && (
                            <a
                              href={p.pdf_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded border border-[#1d3658] bg-[#0c1a2e] px-1.5 py-0.5 font-mono text-[10px] text-cyan-300 hover:border-cyan-400"
                            >
                              PDF ↗
                            </a>
                          )}
                        </div>
                        <a
                          href={p.entry_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="line-clamp-2 font-medium text-xs text-[#f0f5fc] hover:text-cyan-300 hover:underline"
                        >
                          {p.title}
                        </a>
                        <span className="text-[11px] text-[#607899]">
                          {p.published ? p.published.slice(0, 4) : ""} ·{" "}
                          {p.authors.length > 0 ? `${p.authors[0]} et al.` : ""}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1d3658]">
                {/* Row 1: Objective */}
                <tr className="hover:bg-[#0c1a2e]/60 transition-colors">
                  <td className="p-3.5 font-mono text-[11px] font-semibold text-cyan-300 bg-[#0c1a2e] sticky left-0 z-10 align-top">
                    Objective
                  </td>
                  {comparisonResult.papers.map((p, idx) => (
                    <td
                      key={p.arxiv_id}
                      className={`p-3.5 leading-relaxed text-[#f0f5fc] align-top ${
                        idx > 0 ? "border-l border-[#1d3658]" : ""
                      }`}
                    >
                      {p.research_question}
                    </td>
                  ))}
                </tr>

                {/* Row 2: Method */}
                <tr className="hover:bg-[#0c1a2e]/60 transition-colors">
                  <td className="p-3.5 font-mono text-[11px] font-semibold text-cyan-300 bg-[#0c1a2e] sticky left-0 z-10 align-top">
                    Proposed Method
                  </td>
                  {comparisonResult.papers.map((p, idx) => (
                    <td
                      key={p.arxiv_id}
                      className={`p-3.5 leading-relaxed text-[#f0f5fc] align-top ${
                        idx > 0 ? "border-l border-[#1d3658]" : ""
                      }`}
                    >
                      {p.method}
                    </td>
                  ))}
                </tr>

                {/* Row 3: Datasets & Setup */}
                <tr className="hover:bg-[#0c1a2e]/60 transition-colors">
                  <td className="p-3.5 font-mono text-[11px] font-semibold text-cyan-300 bg-[#0c1a2e] sticky left-0 z-10 align-top">
                    Datasets / Setup
                  </td>
                  {comparisonResult.papers.map((p, idx) => (
                    <td
                      key={p.arxiv_id}
                      className={`p-3.5 leading-relaxed align-top ${
                        idx > 0 ? "border-l border-[#1d3658]" : ""
                      } ${
                        p.datasets_or_setup.includes("Not explicitly")
                          ? "text-[#607899] italic"
                          : "text-[#f0f5fc]"
                      }`}
                    >
                      {p.datasets_or_setup}
                    </td>
                  ))}
                </tr>

                {/* Row 4: Findings */}
                <tr className="hover:bg-[#0c1a2e]/60 transition-colors">
                  <td className="p-3.5 font-mono text-[11px] font-semibold text-cyan-300 bg-[#0c1a2e] sticky left-0 z-10 align-top">
                    Reported Findings
                  </td>
                  {comparisonResult.papers.map((p, idx) => (
                    <td
                      key={p.arxiv_id}
                      className={`p-3.5 leading-relaxed text-[#f0f5fc] align-top ${
                        idx > 0 ? "border-l border-[#1d3658]" : ""
                      }`}
                    >
                      {p.reported_findings}
                    </td>
                  ))}
                </tr>

                {/* Row 5: Limitations */}
                <tr className="hover:bg-[#0c1a2e]/60 transition-colors">
                  <td className="p-3.5 font-mono text-[11px] font-semibold text-cyan-300 bg-[#0c1a2e] sticky left-0 z-10 align-top">
                    Author Limitations
                  </td>
                  {comparisonResult.papers.map((p, idx) => (
                    <td
                      key={p.arxiv_id}
                      className={`p-3.5 leading-relaxed align-top ${
                        idx > 0 ? "border-l border-[#1d3658]" : ""
                      } ${
                        p.limitations.includes("Not explicitly")
                          ? "text-[#607899] italic"
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

          {/* Synthesized Cross-Paper Analysis */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Similarities */}
            <div className="rounded-lg border border-[#1d3658] bg-[#071526] p-4">
              <div className="mb-2 flex items-center gap-1.5">
                <span className="text-cyan-400 font-bold" aria-hidden="true">✓</span>
                <h4 className="font-mono text-xs font-bold text-cyan-400">
                  Similarities &amp; Consensus
                </h4>
              </div>
              <ul className="space-y-1.5 text-xs text-[#9cb3cf]">
                {comparisonResult.similarities.length > 0 ? (
                  comparisonResult.similarities.map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-cyan-400 font-bold mt-0.5">•</span>
                      <span className="leading-relaxed">{item}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-[11px] text-[#607899] italic">
                    No notable commonalities identified in abstracts.
                  </li>
                )}
              </ul>
            </div>

            {/* Differences */}
            <div className="rounded-lg border border-[#1d3658] bg-[#071526] p-4">
              <div className="mb-2 flex items-center gap-1.5">
                <span className="text-cyan-300 font-bold" aria-hidden="true">≠</span>
                <h4 className="font-mono text-xs font-bold text-cyan-300">
                  Methodological Differences
                </h4>
              </div>
              <ul className="space-y-1.5 text-xs text-[#9cb3cf]">
                {comparisonResult.differences.length > 0 ? (
                  comparisonResult.differences.map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-cyan-400 font-bold mt-0.5">•</span>
                      <span className="leading-relaxed">{item}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-[11px] text-[#607899] italic">
                    No distinct divergence reported across abstracts.
                  </li>
                )}
              </ul>
            </div>

            {/* Research Gaps */}
            <div className="rounded-lg border border-[#1d3658] bg-[#071526] p-4">
              <div className="mb-2 flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-amber-400 font-bold" aria-hidden="true">?</span>
                  <h4 className="font-mono text-xs font-bold text-amber-400">
                    Potential Research Gaps
                  </h4>
                </div>
                <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-amber-400">
                  Model Interpretation
                </span>
              </div>
              <ul className="space-y-1.5 text-xs text-[#9cb3cf]">
                {comparisonResult.research_gaps.length > 0 ? (
                  comparisonResult.research_gaps.map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-amber-400 font-bold mt-0.5">•</span>
                      <span className="leading-relaxed">{item}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-[11px] text-[#607899] italic">
                    No evident research gaps derived from reported limitations.
                  </li>
                )}
              </ul>
            </div>
          </div>

          {/* Disclaimer */}
          <p className="text-[11px] text-[#607899]">
            ⚠ {comparisonResult.disclaimer}
          </p>
        </div>
      )}
    </section>
  );
}
