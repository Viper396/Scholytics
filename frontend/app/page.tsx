"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
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
const GRAPH_SELECTION_STORAGE_KEY = "scholytics.selectedForGraph";

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
          className="animate-pulse rounded-2xl border border-slate-800 bg-slate-900/70 p-5"
        >
          <div className="mb-4 h-5 w-4/5 rounded bg-slate-800" />
          <div className="mb-2 h-4 w-2/3 rounded bg-slate-800" />
          <div className="mb-2 h-4 w-1/2 rounded bg-slate-800" />
          <div className="mb-2 h-4 w-full rounded bg-slate-800" />
          <div className="h-4 w-11/12 rounded bg-slate-800" />
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
  const [selectedForGraph, setSelectedForGraph] = useState<string[]>([]);

  const normalizedSelectedForGraph = useMemo(() => {
    return Array.from(
      new Set(
        selectedForGraph.map((id) => id.trim()).filter((id) => id.length > 0),
      ),
    );
  }, [selectedForGraph]);

  const selectedGraphCount = normalizedSelectedForGraph.length;

  const graphHref = useMemo(() => {
    if (normalizedSelectedForGraph.length === 0) {
      return "/graph";
    }
    const ids = normalizedSelectedForGraph
      .map((id) => encodeURIComponent(id))
      .join(",");
    return `/graph?ids=${ids}`;
  }, [normalizedSelectedForGraph]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(GRAPH_SELECTION_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }

      const cleaned = parsed
        .map((item) => String(item).trim())
        .filter((item) => item.length > 0);
      setSelectedForGraph(Array.from(new Set(cleaned)));
    } catch {
      // Ignore malformed localStorage state.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      GRAPH_SELECTION_STORAGE_KEY,
      JSON.stringify(normalizedSelectedForGraph),
    );
  }, [normalizedSelectedForGraph]);

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
    setSelectedForGraph((current) => {
      if (current.includes(arxivId)) {
        return current.filter((id) => id !== arxivId);
      }
      return [...current, arxivId];
    });
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

  const showEmptyPrompt = !hasSearched && !isLoading && !errorMessage;
  const showNoResults =
    !isLoading && !errorMessage && hasSearched && results.length === 0;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 selection:bg-cyan-400/25">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 backdrop-blur">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Scholytics
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Semantic paper discovery, synthesis, and graph exploration.
            </p>
          </div>
          <Link
            href={graphHref}
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
          >
            <span>Graph</span>
            <span className="rounded-full bg-slate-950/10 px-2 py-0.5 text-xs">
              {selectedGraphCount}
            </span>
          </Link>
        </header>

        <section className="mx-auto max-w-4xl text-center">
          <h2 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Search Research Faster
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base text-slate-400 sm:text-lg">
            Explore live arXiv results, generate concise summaries, and build
            topic-level insights in one workflow.
          </p>

          <form onSubmit={handleSearchSubmit} className="mt-8">
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                placeholder="Search arXiv topics, methods, or questions"
                className="h-12 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 text-base text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400"
              />
              <button
                type="submit"
                disabled={isLoading}
                className="h-12 rounded-xl bg-cyan-400 px-6 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoading ? "Searching..." : "Search"}
              </button>
            </div>
          </form>
        </section>

        <section className="mx-auto mt-8 w-full max-w-5xl">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">
                  Year Range
                </p>
                <div className="mb-3 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
                  <span>From: {yearFrom}</span>
                  <span>To: {CURRENT_YEAR}</span>
                </div>
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
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">
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
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                          active
                            ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-300"
                            : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
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
                  className="mb-3 block text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300"
                >
                  Result Count
                </label>
                <select
                  id="result-count"
                  value={maxResults}
                  onChange={(event) =>
                    setMaxResults(Number(event.target.value))
                  }
                  className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                </select>
                <p className="mt-2 text-xs text-slate-400">
                  Added to graph:{" "}
                  <span className="font-semibold text-cyan-300">
                    {selectedGraphCount}
                  </span>
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto mt-10 w-full max-w-6xl">
          {showEmptyPrompt && (
            <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center">
              <div>
                <p className="text-3xl font-semibold text-white">
                  Search for any research topic
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  Start with a concept, method, or research question.
                </p>
              </div>
            </div>
          )}

          {isLoading && <SkeletonCards />}

          {!isLoading && errorMessage && (
            <div className="mx-auto max-w-3xl rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-center">
              <p className="mb-3 text-base text-rose-100">{errorMessage}</p>
              <button
                type="button"
                onClick={() => runSearch(activeQuery || queryInput)}
                className="rounded-lg bg-rose-400 px-5 py-2 text-sm font-semibold text-rose-950 transition hover:bg-rose-300"
              >
                Retry
              </button>
            </div>
          )}

          {showNoResults && (
            <div className="mx-auto max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-200">
              No papers found. Try broadening your query or adjusting filters.
            </div>
          )}

          {!isLoading && !errorMessage && results.length > 0 && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-2xl font-semibold text-white">
                    What does research say about {activeQuery}?
                  </h3>
                  <button
                    type="button"
                    onClick={generateSynthesis}
                    disabled={isSynthesizing}
                    className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSynthesizing ? "Generating..." : "Generate Synthesis"}
                  </button>
                </div>

                {synthesisError && (
                  <p className="mb-3 text-sm text-rose-300">{synthesisError}</p>
                )}

                {(synthesisText || isSynthesizing) && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <div className="prose prose-invert max-w-none text-sm leading-7 text-slate-200">
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
                      className="rounded-lg border border-slate-700 px-4 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
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
                  const inGraph = normalizedSelectedForGraph.includes(
                    paper.arxiv_id,
                  );

                  return (
                    <article
                      key={paper.arxiv_id}
                      className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5"
                    >
                      <h4 className="mb-2 line-clamp-2 text-lg font-semibold text-white">
                        {paper.title}
                      </h4>

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
                            className="rounded-full border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
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
                        <div className="h-2 rounded-full bg-slate-800">
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
                          className="rounded-lg bg-cyan-400 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {summaryState?.loading
                            ? "Summarizing..."
                            : "Summarize"}
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleGraphSelection(paper.arxiv_id)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                            inGraph
                              ? "bg-emerald-300 text-emerald-950 hover:bg-emerald-200"
                              : "border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                          }`}
                        >
                          {inGraph ? "Added to Graph" : "Add to Graph"}
                        </button>

                        <a
                          href={paper.pdf_url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
                        >
                          PDF
                        </a>
                      </div>

                      {summaryState?.open && (
                        <div className="rounded-xl border border-cyan-400/25 bg-slate-950 p-3">
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
