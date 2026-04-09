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
const GITHUB_REPO_URL = "https://github.com/Viper396/Scholytics";

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
          className="animate-pulse rounded-2xl border border-[#3b4949]/20 bg-[#171f33]/85 p-5"
        >
          <div className="mb-4 h-5 w-4/5 rounded bg-[#2d3449]" />
          <div className="mb-2 h-4 w-2/3 rounded bg-[#2d3449]" />
          <div className="mb-2 h-4 w-1/2 rounded bg-[#2d3449]" />
          <div className="mb-2 h-4 w-full rounded bg-[#2d3449]" />
          <div className="h-4 w-11/12 rounded bg-[#2d3449]" />
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
        selectedForGraph
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
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

  function openGithubRepo() {
    window.open(GITHUB_REPO_URL, "_blank", "noopener,noreferrer");
  }

  const showEmptyPrompt = !hasSearched && !isLoading && !errorMessage;
  const showNoResults =
    !isLoading && !errorMessage && hasSearched && results.length === 0;

  return (
    <main className="min-h-screen bg-[#0b1326] text-[#dae2fd] selection:bg-[#62e6ff]/30">
      <aside className="fixed left-0 top-0 z-40 hidden h-full w-64 flex-col border-r border-[#3b4949]/20 bg-[#131b2e]/65 backdrop-blur-xl lg:flex">
        <div className="p-6">
          <h1 className="text-xl font-bold tracking-tight text-[#62e6ff]">
            Editorial Intelligence
          </h1>
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-[#bac9c9]/70">
            Luminescent Archivist
          </p>
        </div>

        <nav className="flex-1 space-y-2 px-4 py-4">
          <button className="w-full rounded-lg px-4 py-3 text-left text-sm text-[#bac9c9] transition hover:bg-[#2d3449]/40 hover:text-[#62e6ff]">
            Dashboard
          </button>
          <button className="w-full rounded-lg border-l-2 border-[#62e6ff] bg-[#2d3449]/50 px-4 py-3 text-left text-sm font-semibold text-[#62e6ff]">
            Library
          </button>
          <button className="w-full rounded-lg px-4 py-3 text-left text-sm text-[#bac9c9] transition hover:bg-[#2d3449]/40 hover:text-[#62e6ff]">
            Analytics
          </button>
          <button className="w-full rounded-lg px-4 py-3 text-left text-sm text-[#bac9c9] transition hover:bg-[#2d3449]/40 hover:text-[#62e6ff]">
            Intelligence
          </button>
          <button className="w-full rounded-lg px-4 py-3 text-left text-sm text-[#bac9c9] transition hover:bg-[#2d3449]/40 hover:text-[#62e6ff]">
            Settings
          </button>
        </nav>

        <div className="border-t border-[#3b4949]/20 p-4">
          <button className="w-full rounded-xl bg-linear-to-r from-[#62e6ff] to-[#04cce6] px-4 py-3 text-sm font-bold text-[#00363e]">
            New Analysis
          </button>
        </div>

        <div className="space-y-1 p-4 text-xs text-[#bac9c9]/80">
          <button className="w-full rounded-lg px-4 py-2 text-left transition hover:bg-[#2d3449]/30 hover:text-[#62e6ff]">
            Support
          </button>
          <button
            type="button"
            onClick={openGithubRepo}
            className="w-full rounded-lg px-4 py-2 text-left transition hover:bg-[#2d3449]/30 hover:text-[#62e6ff]"
          >
            Github
          </button>
        </div>
      </aside>

      <header className="fixed top-0 z-50 flex h-16 w-full items-center justify-between border-b border-[#3b4949]/20 bg-[#0b1326]/80 px-4 backdrop-blur-md lg:ml-64 lg:w-[calc(100%-16rem)] lg:pl-8 lg:pr-8">
        <div className="flex items-center gap-6">
          <span className="text-xl font-black tracking-tight text-[#62e6ff] lg:text-2xl">
            Scholytics
          </span>
          <div className="hidden items-center gap-6 md:flex">
            <span className="border-b-2 border-[#62e6ff] pb-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#62e6ff]">
              Trends
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#bac9c9]">
              Archives
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openGithubRepo}
            className="rounded-lg border border-[#3b4949] px-3 py-1.5 text-xs font-semibold text-[#dae2fd] transition hover:bg-[#2d3449]/70"
          >
            Connect GitHub
          </button>
          <Link
            href={graphHref}
            className="rounded-lg bg-linear-to-r from-[#62e6ff] to-[#04cce6] px-3 py-1.5 text-xs font-bold text-[#00363e] transition hover:opacity-90"
          >
            Graph ({selectedGraphCount})
          </Link>
        </div>
      </header>

      <div className="relative overflow-hidden lg:ml-64">
        <div className="pointer-events-none absolute -right-24 top-0 h-128 w-lg rounded-full bg-[#62e6ff]/10 blur-[120px]" />
        <div className="pointer-events-none absolute -left-24 top-96 h-96 w-96 rounded-full bg-[#7be7d9]/10 blur-[100px]" />

        <section className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 pb-14 pt-24 sm:px-8 lg:px-12">
          <div className="mb-10 space-y-4 text-center">
            <h2 className="text-4xl font-bold tracking-tight text-[#dae2fd] sm:text-5xl lg:text-6xl">
              Synthesize the <span className="italic text-[#62e6ff]">Unseen</span>.
            </h2>
            <p className="mx-auto max-w-2xl text-base text-[#bac9c9] sm:text-lg">
              Traverse fast-moving research with an editorial lens. Scholytics combines semantic retrieval, synthesis, and graph exploration in one workflow.
            </p>
          </div>

          <form onSubmit={handleSearchSubmit} className="group w-full max-w-4xl">
            <div className="relative rounded-2xl bg-linear-to-r from-[#62e6ff]/20 to-[#7be7d9]/15 p-px transition duration-300 group-focus-within:shadow-[0_0_30px_rgba(98,230,255,0.25)]">
              <div className="flex items-center gap-2 rounded-2xl bg-[#060e20] p-2 pl-5">
                <input
                  value={queryInput}
                  onChange={(event) => setQueryInput(event.target.value)}
                  placeholder="Quantum Computing in Neural Networks..."
                  className="h-12 w-full border-none bg-transparent text-lg text-[#dae2fd] placeholder:text-[#859493] focus:outline-none focus:ring-0"
                />
                <button
                  type="submit"
                  disabled={isLoading}
                  className="rounded-xl bg-linear-to-r from-[#62e6ff] to-[#04cce6] px-6 py-3 text-sm font-bold text-[#00363e] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoading ? "Scanning..." : "Scan"}
                </button>
              </div>
            </div>
          </form>

          <div className="mt-6 w-full max-w-5xl rounded-2xl border border-[#3b4949]/25 bg-[#2d3449]/45 p-6 backdrop-blur-xl">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <div className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#62e6ff]">
                  Temporal Range
                </p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 rounded-lg border border-[#3b4949]/30 bg-[#060e20] px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-[#859493]">
                      From
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[#dae2fd]">
                      {yearFrom}
                    </p>
                  </div>
                  <div className="h-px w-4 bg-[#3b4949]" />
                  <div className="flex-1 rounded-lg border border-[#3b4949]/30 bg-[#060e20] px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-[#859493]">
                      To
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[#dae2fd]">
                      {CURRENT_YEAR}
                    </p>
                  </div>
                </div>
                <input
                  type="range"
                  min={2015}
                  max={CURRENT_YEAR}
                  value={yearFrom}
                  onChange={(event) => setYearFrom(Number(event.target.value))}
                  className="w-full accent-[#62e6ff]"
                />
              </div>

              <div className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#62e6ff]">
                  Domain Filter
                </p>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_CATEGORIES.map((category) => {
                    const active = selectedCategories.includes(category);
                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() => toggleCategory(category)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                          active
                            ? "border-[#62e6ff]/40 bg-[#62e6ff]/15 text-[#62e6ff]"
                            : "border-[#3b4949]/35 bg-[#171f33] text-[#bac9c9] hover:border-[#62e6ff]/30 hover:text-[#dae2fd]"
                        }`}
                      >
                        {category}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="result-count"
                    className="text-xs font-bold uppercase tracking-[0.18em] text-[#62e6ff]"
                  >
                    Extraction Depth
                  </label>
                  <span className="rounded bg-[#2d3449] px-2 py-0.5 text-[10px] font-bold text-[#dae2fd]">
                    {maxResults} results
                  </span>
                </div>
                <select
                  id="result-count"
                  value={maxResults}
                  onChange={(event) => setMaxResults(Number(event.target.value))}
                  className="h-11 w-full rounded-lg border border-[#3b4949]/35 bg-[#060e20] px-3 text-sm text-[#dae2fd] outline-none focus:border-[#62e6ff]/40"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                </select>
                <p className="text-xs text-[#859493]">
                  Added to graph: <span className="font-semibold text-[#62e6ff]">{selectedGraphCount}</span>
                </p>
              </div>
            </div>
          </div>

          <section className="mt-10 w-full">
            {showEmptyPrompt && (
              <div className="grid h-full min-h-64 place-items-center rounded-2xl border border-dashed border-[#3b4949]/30 bg-[#171f33]/35 p-8 text-center">
                <div>
                  <p className="text-3xl font-semibold text-[#dae2fd]">Search for any research topic</p>
                  <p className="mt-2 text-sm text-[#859493]">Start with a concept, method, or research question.</p>
                </div>
              </div>
            )}

            {isLoading && <SkeletonCards />}

            {!isLoading && errorMessage && (
              <div className="mx-auto max-w-3xl rounded-2xl border border-[#93000a]/50 bg-[#93000a]/20 p-6 text-center">
                <p className="mb-3 text-base text-[#ffdad6]">{errorMessage}</p>
                <button
                  type="button"
                  onClick={() => runSearch(activeQuery || queryInput)}
                  className="rounded-lg bg-[#ffb4ab] px-5 py-2 text-sm font-semibold text-[#690005] transition hover:opacity-90"
                >
                  Retry
                </button>
              </div>
            )}

            {showNoResults && (
              <div className="mx-auto max-w-3xl rounded-2xl border border-[#3b4949]/30 bg-[#2d3449]/40 p-8 text-center text-[#dae2fd]">
                No papers found. Try broadening your query or adjusting filters.
              </div>
            )}

            {!isLoading && !errorMessage && results.length > 0 && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-[#3b4949]/30 bg-[#171f33]/80 p-6 shadow-2xl shadow-black/20">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-2xl font-semibold text-[#dae2fd]">
                      What does research say about {activeQuery}?
                    </h3>
                    <button
                      type="button"
                      onClick={generateSynthesis}
                      disabled={isSynthesizing}
                      className="rounded-xl bg-linear-to-r from-[#62e6ff] to-[#04cce6] px-4 py-2 text-sm font-bold text-[#00363e] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSynthesizing ? "Generating..." : "Generate Synthesis"}
                    </button>
                  </div>

                  {synthesisError && (
                    <p className="mb-3 text-sm text-[#ffb4ab]">{synthesisError}</p>
                  )}

                  {(synthesisText || isSynthesizing) && (
                    <div className="rounded-xl border border-[#3b4949]/35 bg-[#060e20] p-4">
                      <div className="prose prose-invert max-w-none text-sm leading-7 text-[#dae2fd]">
                        <ReactMarkdown>{synthesisText}</ReactMarkdown>
                        {isSynthesizing && (
                          <span className="ml-1 inline-block h-5 w-2 animate-pulse rounded-sm bg-[#62e6ff] align-middle" />
                        )}
                      </div>
                    </div>
                  )}

                  {isSynthesisComplete && synthesisText && (
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={copySynthesis}
                        className="rounded-lg border border-[#3b4949]/40 px-4 py-1.5 text-xs font-semibold text-[#dae2fd] transition hover:bg-[#2d3449]/45"
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
                        className="rounded-2xl border border-[#3b4949]/30 bg-[#171f33]/85 p-5 shadow-xl shadow-black/20"
                      >
                        <h4 className="mb-2 line-clamp-2 text-lg font-semibold text-[#dae2fd]">
                          {paper.title}
                        </h4>

                        <p className="mb-1 text-sm text-[#bac9c9]">
                          {paper.authors.join(", ") || "Unknown authors"}
                        </p>
                        <p className="mb-3 text-xs text-[#859493]">
                          Published: {formatDate(paper.published)}
                        </p>

                        <div className="mb-3 flex flex-wrap gap-2">
                          {paper.categories.slice(0, 4).map((category) => (
                            <span
                              key={`${paper.arxiv_id}-${category}`}
                              className="rounded-full border border-[#3b4949]/40 bg-[#2d3449]/55 px-2 py-1 text-xs text-[#dae2fd]"
                            >
                              {category}
                            </span>
                          ))}
                        </div>

                        <div className="mb-3">
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="text-[#859493]">Relevance</span>
                            <span className="font-medium text-[#62e6ff]">
                              {(score * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-[#2d3449]">
                            <div
                              className="h-2 rounded-full bg-linear-to-r from-[#62e6ff] to-[#04cce6] transition-all"
                              style={{ width: `${(score * 100).toFixed(1)}%` }}
                            />
                          </div>
                        </div>

                        <div className="mb-3 text-sm text-[#bac9c9]">
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
                            className="mt-1 text-xs font-medium text-[#62e6ff] hover:text-[#a2eeff]"
                          >
                            {abstractExpanded ? "Show less" : "Read more"}
                          </button>
                        </div>

                        <div className="mb-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => summarizePaper(paper.arxiv_id)}
                            disabled={summaryState?.loading}
                            className="rounded-lg bg-linear-to-r from-[#62e6ff] to-[#04cce6] px-3 py-1.5 text-xs font-semibold text-[#00363e] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {summaryState?.loading ? "Summarizing..." : "Summarize"}
                          </button>

                          <button
                            type="button"
                            onClick={() => toggleGraphSelection(paper.arxiv_id)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                              inGraph
                                ? "bg-[#6bd8cb] text-[#00201d] hover:bg-[#89f5e7]"
                                : "border border-[#3b4949]/40 bg-[#2d3449]/60 text-[#dae2fd] hover:bg-[#3e495d]"
                            }`}
                          >
                            {inGraph ? "Added to Graph" : "Add to Graph"}
                          </button>

                          <a
                            href={paper.pdf_url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-[#3b4949]/45 px-3 py-1.5 text-xs font-semibold text-[#dae2fd] transition hover:bg-[#2d3449]/45"
                          >
                            PDF
                          </a>
                        </div>

                        {summaryState?.open && (
                          <div className="rounded-xl border border-[#62e6ff]/30 bg-[#060e20] p-3">
                            {summaryState.loading && (
                              <p className="text-sm text-[#a2eeff]">Generating summary...</p>
                            )}
                            {!summaryState.loading && summaryState.error && (
                              <p className="text-sm text-[#ffb4ab]">{summaryState.error}</p>
                            )}
                            {!summaryState.loading &&
                              !summaryState.error &&
                              summaryState.summary && (
                                <div className="space-y-2">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-[#62e6ff]">
                                    Summary
                                  </p>
                                  <p className="text-sm leading-6 text-[#dae2fd]">
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
        </section>
      </div>
    </main>
  );
}
