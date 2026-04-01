"use client";

import { FormEvent, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";

type PaperResult = {
  arxiv_id: string;
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  categories: string[];
  pdf_url: string;
  entry_url: string;
  relevance_score: number;
};

type SearchResponse = {
  query: string;
  results: PaperResult[];
  total: number;
};

type SummaryState = {
  loading: boolean;
  open: boolean;
  summary?: string;
  error?: string;
};

const AVAILABLE_CATEGORIES = ["cs.AI", "cs.LG", "cs.CV", "cs.CL", "stat.ML"];
const CURRENT_YEAR = new Date().getFullYear();

function clampScore(score: number): number {
  if (Number.isNaN(score)) {
    return 0;
  }
  return Math.max(0, Math.min(1, score));
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "Unknown date";
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function SkeletonCards() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map((key) => (
        <div
          key={key}
          className="animate-pulse rounded-2xl border border-slate-700 bg-slate-800 p-5"
        >
          <div className="mb-4 h-5 w-4/5 rounded bg-slate-700" />
          <div className="mb-2 h-4 w-2/3 rounded bg-slate-700" />
          <div className="mb-2 h-4 w-1/2 rounded bg-slate-700" />
          <div className="mb-2 h-4 w-full rounded bg-slate-700" />
          <div className="h-4 w-11/12 rounded bg-slate-700" />
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [queryInput, setQueryInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [yearFrom, setYearFrom] = useState(2015);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [maxResults, setMaxResults] = useState<number>(10);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [results, setResults] = useState<PaperResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [synthesisText, setSynthesisText] = useState("");
  const [synthesisError, setSynthesisError] = useState<string | null>(null);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isSynthesisComplete, setIsSynthesisComplete] = useState(false);
  const [copyLabel, setCopyLabel] = useState("Copy");

  const [expandedAbstracts, setExpandedAbstracts] = useState<
    Record<string, boolean>
  >({});
  const [summaryById, setSummaryById] = useState<Record<string, SummaryState>>(
    {},
  );
  const [graphSelection, setGraphSelection] = useState<Record<string, boolean>>(
    {},
  );

  const selectedGraphCount = useMemo(
    () => Object.values(graphSelection).filter(Boolean).length,
    [graphSelection],
  );

  async function runSearch(nextQuery?: string) {
    const query = (nextQuery ?? queryInput).trim();
    if (!query) {
      setErrorMessage("Please enter a research topic to search.");
      setHasSearched(true);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setHasSearched(true);
    setActiveQuery(query);
    setSynthesisText("");
    setSynthesisError(null);
    setIsSynthesizing(false);
    setIsSynthesisComplete(false);
    setCopyLabel("Copy");

    try {
      const payload: {
        query: string;
        max_results: number;
        filters: { date_from: string; categories?: string[] };
      } = {
        query,
        max_results: maxResults,
        filters: {
          date_from: `${yearFrom}-01-01`,
        },
      };

      if (selectedCategories.length > 0) {
        payload.filters.categories = selectedCategories;
      }

      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("Search failed. Please try again in a moment.");
      }

      const data = (await response.json()) as SearchResponse;
      setResults(data.results ?? []);
      setExpandedAbstracts({});
      setSummaryById({});
      setGraphSelection({});
    } catch (error) {
      setResults([]);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong while searching. Please retry.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function generateSynthesis() {
    const synthesisQuery = activeQuery.trim();
    const topArxivIds = results.slice(0, 5).map((paper) => paper.arxiv_id);

    if (!synthesisQuery || topArxivIds.length === 0) {
      setSynthesisError(
        "Run a search with results before generating synthesis.",
      );
      return;
    }

    setSynthesisText("");
    setSynthesisError(null);
    setIsSynthesizing(true);
    setIsSynthesisComplete(false);
    setCopyLabel("Copy");

    try {
      const response = await fetch("/api/search/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: synthesisQuery,
          arxiv_ids: topArxivIds,
        }),
      });

      if (!response.ok) {
        throw new Error("Could not generate synthesis right now.");
      }

      if (!response.body) {
        throw new Error("Streaming is not supported in this browser.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        let boundaryIndex = buffer.indexOf("\n\n");
        while (boundaryIndex !== -1) {
          const rawEvent = buffer.slice(0, boundaryIndex);
          buffer = buffer.slice(boundaryIndex + 2);

          let eventType = "message";
          const dataLines: string[] = [];

          for (const rawLine of rawEvent.split("\n")) {
            const line = rawLine.replace(/\r$/, "");
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              const content = line.slice(5);
              dataLines.push(
                content.startsWith(" ") ? content.slice(1) : content,
              );
            }
          }

          const data = dataLines.join("\n");

          if (eventType === "done") {
            setIsSynthesizing(false);
            setIsSynthesisComplete(true);
            return;
          }

          if (eventType === "error") {
            throw new Error(data || "Synthesis unavailable.");
          }

          if (data) {
            setSynthesisText((current) => current + data);
          }

          boundaryIndex = buffer.indexOf("\n\n");
        }
      }

      setIsSynthesisComplete(true);
    } catch (error) {
      setSynthesisError(
        error instanceof Error ? error.message : "Synthesis unavailable.",
      );
    } finally {
      setIsSynthesizing(false);
    }
  }

  async function copySynthesis() {
    if (!synthesisText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(synthesisText);
      setCopyLabel("Copied");
      window.setTimeout(() => setCopyLabel("Copy"), 1200);
    } catch {
      setCopyLabel("Copy failed");
      window.setTimeout(() => setCopyLabel("Copy"), 1200);
    }
  }

  async function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch();
  }

  function toggleCategory(category: string) {
    setSelectedCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
  }

  function toggleAbstract(arxivId: string) {
    setExpandedAbstracts((current) => ({
      ...current,
      [arxivId]: !current[arxivId],
    }));
  }

  function toggleGraphSelection(arxivId: string) {
    setGraphSelection((current) => ({
      ...current,
      [arxivId]: !current[arxivId],
    }));
  }

  async function summarizePaper(arxivId: string) {
    setSummaryById((current) => ({
      ...current,
      [arxivId]: {
        ...current[arxivId],
        open: true,
        loading: true,
        error: undefined,
      },
    }));

    try {
      const response = await fetch(
        `/api/papers/${encodeURIComponent(arxivId)}/summarize`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        throw new Error("Summary unavailable right now.");
      }

      const data = (await response.json()) as {
        arxiv_id: string;
        summary: string;
      };
      setSummaryById((current) => ({
        ...current,
        [arxivId]: {
          loading: false,
          open: true,
          summary: data.summary,
          error: undefined,
        },
      }));
    } catch (error) {
      setSummaryById((current) => ({
        ...current,
        [arxivId]: {
          loading: false,
          open: true,
          summary: undefined,
          error:
            error instanceof Error ? error.message : "Summary unavailable.",
        },
      }));
    }
  }

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col px-6 pb-12 pt-12 md:px-10">
        <section className="mx-auto w-full max-w-4xl">
          <h1 className="mb-8 text-center text-4xl font-semibold tracking-tight text-slate-100 md:text-5xl">
            PaperScope
          </h1>

          <form
            onSubmit={handleSearchSubmit}
            className="mb-4 flex w-full gap-3"
          >
            <input
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder="Search arXiv topics, methods, or questions"
              className="h-12 flex-1 rounded-full border border-slate-600 bg-slate-950 px-5 text-slate-100 outline-none transition focus:border-cyan-400"
            />
            <button
              type="submit"
              disabled={isLoading}
              className="h-12 rounded-full bg-cyan-500 px-6 font-medium text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? "Searching..." : "Search"}
            </button>
          </form>

          <div className="rounded-2xl border border-slate-700 bg-slate-800/70 p-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Year From: <span className="text-cyan-300">{yearFrom}</span>
                </label>
                <input
                  type="range"
                  min={2015}
                  max={CURRENT_YEAR}
                  value={yearFrom}
                  onChange={(event) => setYearFrom(Number(event.target.value))}
                  className="w-full accent-cyan-400"
                />
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-slate-300">
                  Categories
                </p>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_CATEGORIES.map((category) => {
                    const active = selectedCategories.includes(category);
                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() => toggleCategory(category)}
                        className={`rounded-full border px-3 py-1 text-xs transition ${
                          active
                            ? "border-cyan-300 bg-cyan-300/20 text-cyan-100"
                            : "border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-500"
                        }`}
                      >
                        {category}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label
                  htmlFor="result-count"
                  className="mb-2 block text-sm font-medium text-slate-300"
                >
                  Result Count
                </label>
                <select
                  id="result-count"
                  value={maxResults}
                  onChange={(event) =>
                    setMaxResults(Number(event.target.value))
                  }
                  className="h-10 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-slate-100 outline-none focus:border-cyan-400"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                </select>
                <p className="mt-2 text-xs text-slate-400">
                  Added to graph:{" "}
                  <span className="text-cyan-300">{selectedGraphCount}</span>
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8">
          {!hasSearched && !isLoading && !errorMessage && (
            <div className="flex min-h-80 items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-800/30">
              <p className="text-center text-3xl font-medium text-slate-300">
                Search for any research topic
              </p>
            </div>
          )}

          {isLoading && <SkeletonCards />}

          {!isLoading && errorMessage && (
            <div className="mx-auto max-w-2xl rounded-2xl border border-rose-400/30 bg-rose-500/10 p-6 text-center">
              <p className="mb-4 text-lg text-rose-100">{errorMessage}</p>
              <button
                type="button"
                onClick={() => runSearch(activeQuery || queryInput)}
                className="rounded-full bg-rose-400 px-5 py-2 text-sm font-semibold text-slate-900 transition hover:bg-rose-300"
              >
                Retry
              </button>
            </div>
          )}

          {!isLoading &&
            !errorMessage &&
            hasSearched &&
            results.length === 0 && (
              <div className="mx-auto max-w-2xl rounded-2xl border border-slate-700 bg-slate-800/50 p-8 text-center text-slate-300">
                No papers found. Try broadening your query or adjusting filters.
              </div>
            )}

          {!isLoading && !errorMessage && results.length > 0 && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-lg shadow-slate-950/20">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-xl font-semibold text-slate-100">
                    What does research say about {activeQuery}?
                  </h2>
                  <button
                    type="button"
                    onClick={generateSynthesis}
                    disabled={isSynthesizing}
                    className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isSynthesizing ? "Generating..." : "Generate Synthesis"}
                  </button>
                </div>

                {synthesisError && (
                  <p className="mb-3 text-sm text-rose-300">{synthesisError}</p>
                )}

                {(synthesisText || isSynthesizing) && (
                  <div className="rounded-xl border border-slate-600 bg-slate-900/70 p-4">
                    <div className="text-sm leading-7 text-slate-200">
                      <ReactMarkdown>{synthesisText}</ReactMarkdown>
                      {isSynthesizing && (
                        <span className="ml-1 inline-block h-5 w-2 animate-pulse rounded-sm bg-cyan-300 align-middle" />
                      )}
                    </div>
                  </div>
                )}

                {isSynthesisComplete && synthesisText && (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={copySynthesis}
                      className="rounded-full border border-slate-500 px-4 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-300 hover:text-white"
                    >
                      {copyLabel}
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {results.map((paper) => {
                  const score = clampScore(paper.relevance_score);
                  const summaryState = summaryById[paper.arxiv_id];
                  const abstractExpanded = !!expandedAbstracts[paper.arxiv_id];
                  const inGraph = !!graphSelection[paper.arxiv_id];

                  return (
                    <article
                      key={paper.arxiv_id}
                      className="rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-lg shadow-slate-950/20"
                    >
                      <h2 className="mb-2 line-clamp-2 text-lg font-semibold text-slate-100">
                        {paper.title}
                      </h2>

                      <p className="mb-1 text-sm text-slate-300">
                        {paper.authors.join(", ") || "Unknown authors"}
                      </p>
                      <p className="mb-3 text-xs text-slate-400">
                        Published: {formatDate(paper.published)}
                      </p>

                      <div className="mb-3 flex flex-wrap gap-2">
                        {paper.categories.slice(0, 4).map((category) => (
                          <span
                            key={`${paper.arxiv_id}-${category}`}
                            className="rounded-full border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-300"
                          >
                            {category}
                          </span>
                        ))}
                      </div>

                      <div className="mb-3">
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="text-slate-400">Relevance</span>
                          <span className="font-medium text-cyan-300">
                            {(score * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-700">
                          <div
                            className="h-2 rounded-full bg-cyan-400 transition-all"
                            style={{ width: `${(score * 100).toFixed(1)}%` }}
                          />
                        </div>
                      </div>

                      <div className="mb-3 text-sm text-slate-300">
                        <p
                          className={
                            abstractExpanded
                              ? "leading-6"
                              : "overflow-hidden leading-6 [display:-webkit-box] [-webkit-line-clamp:3] [-webkit-box-orient:vertical]"
                          }
                        >
                          {paper.abstract}
                        </p>
                        <button
                          type="button"
                          onClick={() => toggleAbstract(paper.arxiv_id)}
                          className="mt-1 text-xs font-medium text-cyan-300 hover:text-cyan-200"
                        >
                          {abstractExpanded ? "Show less" : "Read more"}
                        </button>
                      </div>

                      <div className="mb-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => summarizePaper(paper.arxiv_id)}
                          disabled={summaryState?.loading}
                          className="rounded-full bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {summaryState?.loading
                            ? "Summarizing..."
                            : "Summarize"}
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleGraphSelection(paper.arxiv_id)}
                          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                            inGraph
                              ? "bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
                              : "bg-slate-700 text-slate-100 hover:bg-slate-600"
                          }`}
                        >
                          {inGraph ? "Added to Graph" : "Add to Graph"}
                        </button>

                        <a
                          href={paper.pdf_url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-slate-500 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-300 hover:text-white"
                        >
                          PDF
                        </a>
                      </div>

                      {summaryState?.open && (
                        <div className="rounded-xl border border-cyan-400/30 bg-slate-900/60 p-3">
                          {summaryState.loading && (
                            <p className="text-sm text-cyan-200">
                              Generating summary...
                            </p>
                          )}
                          {!summaryState.loading && summaryState.error && (
                            <p className="text-sm text-rose-300">
                              {summaryState.error}
                            </p>
                          )}
                          {!summaryState.loading &&
                            !summaryState.error &&
                            summaryState.summary && (
                              <div className="space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">
                                  Summary
                                </p>
                                <p className="text-sm leading-6 text-slate-200">
                                  {summaryState.summary}
                                </p>
                              </div>
                            )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
