"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

// ─── Types ────────────────────────────────────────────────────────────────────

type PaperResult = {
  arxiv_id: string;
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  categories: string[];
  pdf_url: string;
  entry_url: string;
  relevance_score: number | null;
  ranking_degraded?: boolean;
};

type SearchResponse = {
  query: string;
  results: PaperResult[];
  total: number;
  ranking_note?: string;
};

type SummaryState = {
  loading: boolean;
  open: boolean;
  summary?: string;
  error?: string;
};

type ReadingListEntry = {
  arxiv_id: string;
  title: string;
  authors: string[];
  published: string;
  pdf_url: string;
  entry_url: string;
  savedAt: string;
};

type SynthesisSource = {
  source_index: number;
  arxiv_id: string;
  title: string;
  authors: string[];
  published: string;
  entry_url: string;
  pdf_url: string;
  has_abstract: boolean;
  categories: string[];
};

type SynthesisValidation = {
  cited_sources: number[];
  invalid_citations: number[];
  has_hallucinations: boolean;
  citation_count: number;
};

type PaperComparisonItem = {
  arxiv_id: string;
  title: string;
  entry_url: string;
  pdf_url: string;
  authors: string[];
  published: string;
  research_question: string;
  method: string;
  datasets_or_setup: string;
  reported_findings: string;
  limitations: string;
};

type ComparisonResult = {
  papers: PaperComparisonItem[];
  similarities: string[];
  differences: string[];
  research_gaps: string[];
  disclaimer: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const AVAILABLE_CATEGORIES = [
  "cs.AI", "cs.LG", "cs.CV", "cs.CL", "stat.ML",
];

const EXAMPLE_QUERIES = [
  "Retrieval-augmented generation evaluation",
  "LLM reasoning and inference-time scaling",
  "Efficient vision transformers",
  "AI agent planning",
];

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 2015;
const GRAPH_SELECTION_STORAGE_KEY = "scholytics.selectedForGraph";
const READING_LIST_STORAGE_KEY = "scholytics.readingList";

// ─── Utility functions ────────────────────────────────────────────────────────

function clampScore(score: number | null): number {
  if (score === null || Number.isNaN(score)) return 0;
  return Math.max(0, Math.min(1, score));
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "Unknown date";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function loadReadingList(): ReadingListEntry[] {
  try {
    const raw = window.localStorage.getItem(READING_LIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof item.arxiv_id === "string",
    );
  } catch {
    return [];
  }
}

function saveReadingList(list: ReadingListEntry[]) {
  try {
    window.localStorage.setItem(READING_LIST_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // localStorage may be full or unavailable; fail silently.
  }
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function SkeletonCards() {
  return (
    <div
      className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
      role="status"
      aria-label="Loading search results"
    >
      {[0, 1, 2, 3, 4, 5].map((key) => (
        <div
          key={key}
          className="animate-pulse rounded-[14px] border p-5"
          style={{
            borderColor: "var(--border-subtle)",
            backgroundColor: "var(--bg-surface)",
          }}
        >
          <div className="mb-4 h-5 w-4/5 rounded-md" style={{ backgroundColor: "var(--bg-elevated)" }} />
          <div className="mb-2 h-3.5 w-2/3 rounded" style={{ backgroundColor: "var(--bg-elevated)" }} />
          <div className="mb-2 h-3.5 w-1/2 rounded" style={{ backgroundColor: "var(--bg-elevated)" }} />
          <div className="mb-2 h-3 w-full rounded" style={{ backgroundColor: "var(--bg-elevated)" }} />
          <div className="h-3 w-11/12 rounded" style={{ backgroundColor: "var(--bg-elevated)" }} />
        </div>
      ))}
    </div>
  );
}

// ─── Reading list panel ───────────────────────────────────────────────────────

function ReadingListPanel({
  list,
  onRemove,
  onClear,
  onClose,
}: {
  list: ReadingListEntry[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col shadow-2xl"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderLeft: "1px solid var(--border-default)",
      }}
      role="dialog"
      aria-label="Reading list"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-4"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
          Reading List
          <span
            className="ml-2 rounded-full px-2 py-0.5 text-xs font-bold"
            style={{
              backgroundColor: "var(--cyan-subtle)",
              color: "var(--text-accent)",
            }}
          >
            {list.length}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          {list.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="rounded-md px-2 py-1 text-xs font-medium transition-colors hover:opacity-80"
              style={{ color: "var(--error)", border: "1px solid var(--error-border)" }}
              aria-label="Clear entire reading list"
            >
              Clear all
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 transition-colors hover:opacity-80"
            style={{
              backgroundColor: "var(--bg-elevated)",
              color: "var(--text-secondary)",
            }}
            aria-label="Close reading list"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {list.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            No saved papers yet. Click{" "}
            <span style={{ color: "var(--text-accent)" }}>Save</span> on any paper
            to add it here. Papers are stored locally in this browser.
          </p>
        ) : (
          <ul className="space-y-3" role="list">
            {list.map((entry) => (
              <li
                key={entry.arxiv_id}
                className="rounded-xl p-3"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <p
                  className="mb-1 line-clamp-2 text-sm font-medium leading-snug"
                  style={{ color: "var(--text-primary)" }}
                >
                  {entry.title}
                </p>
                <p className="mb-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                  {formatDate(entry.published)} · {entry.arxiv_id}
                </p>
                <div className="flex gap-2">
                  {entry.pdf_url && (
                    <a
                      href={entry.pdf_url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md px-2.5 py-1 text-xs font-semibold transition-colors"
                      style={{
                        backgroundColor: "var(--cyan-subtle)",
                        color: "var(--text-accent)",
                        border: "1px solid rgba(6,182,212,0.25)",
                      }}
                    >
                      PDF
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemove(entry.arxiv_id)}
                    className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-80"
                    style={{ color: "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}
                    aria-label={`Remove ${entry.title} from reading list`}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p
        className="p-4 text-xs"
        style={{
          color: "var(--text-muted)",
          borderTop: "1px solid var(--border-subtle)",
        }}
      >
        Saved locally in this browser — not synced across devices.
      </p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [queryInput, setQueryInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [yearFrom, setYearFrom] = useState(MIN_YEAR);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [maxResults, setMaxResults] = useState<number>(10);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [results, setResults] = useState<PaperResult[]>([]);
  const [rankingNote, setRankingNote] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const [synthesisText, setSynthesisText] = useState("");
  const [synthesisSources, setSynthesisSources] = useState<SynthesisSource[]>([]);
  const [synthesisValidation, setSynthesisValidation] = useState<SynthesisValidation | null>(null);
  const [synthesisError, setSynthesisError] = useState<string | null>(null);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isSynthesisComplete, setIsSynthesisComplete] = useState(false);
  const [copyLabel, setCopyLabel] = useState("Copy");
  const synthesisAbortRef = useRef<AbortController | null>(null);

  const [expandedAbstracts, setExpandedAbstracts] = useState<Record<string, boolean>>({});
  const [summaryById, setSummaryById] = useState<Record<string, SummaryState>>({});
  const [selectedForGraph, setSelectedForGraph] = useState<string[]>([]);
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [showComparisonView, setShowComparisonView] = useState(false);
  const comparisonAbortRef = useRef<AbortController | null>(null);

  const [readingList, setReadingList] = useState<ReadingListEntry[]>([]);
  const [showReadingList, setShowReadingList] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const searchCacheRef = useRef<Map<string, SearchResponse>>(new Map());

  // ── Computed ──────────────────────────────────────────────────────────────

  const normalizedSelectedForGraph = useMemo(
    () =>
      Array.from(
        new Set(
          selectedForGraph.map((id) => id.trim()).filter((id) => id.length > 0),
        ),
      ),
    [selectedForGraph],
  );

  const selectedGraphCount = normalizedSelectedForGraph.length;

  const graphHref = useMemo(() => {
    if (normalizedSelectedForGraph.length === 0) return "/graph";
    const ids = normalizedSelectedForGraph
      .map((id) => encodeURIComponent(id))
      .join(",");
    return `/graph?ids=${ids}`;
  }, [normalizedSelectedForGraph]);

  const savedIds = useMemo(
    () => new Set(readingList.map((e) => e.arxiv_id)),
    [readingList],
  );

  const activeFilterCount =
    (yearFrom > MIN_YEAR ? 1 : 0) + selectedCategories.length;

  // ── Hydrate from localStorage ─────────────────────────────────────────────

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(GRAPH_SELECTION_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const cleaned = parsed
        .map((item) => String(item).trim())
        .filter((item) => item.length > 0);
      setSelectedForGraph(Array.from(new Set(cleaned)));
    } catch {
      // Ignore malformed localStorage state.
    }

    setReadingList(loadReadingList());
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      GRAPH_SELECTION_STORAGE_KEY,
      JSON.stringify(normalizedSelectedForGraph),
    );
  }, [normalizedSelectedForGraph]);

  // ── Search ────────────────────────────────────────────────────────────────

  const runSearch = useCallback(
    async (nextQuery?: string) => {
      const query = (nextQuery ?? queryInput).trim();
      if (!query) {
        setErrorMessage("Please enter a research topic to search.");
        setHasSearched(true);
        return;
      }

      // Cancel any in-flight search.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Cancel or invalidate synthesis when a new search starts
      synthesisAbortRef.current?.abort();
      setIsSynthesizing(false);
      setSynthesisText("");
      setSynthesisSources([]);
      setSynthesisValidation(null);
      setSynthesisError(null);
      setIsSynthesisComplete(false);
      setCopyLabel("Copy");

      // Cancel any in-flight comparison when search changes
      comparisonAbortRef.current?.abort();
      setIsComparing(false);

      setIsLoading(true);
      setErrorMessage(null);
      setHasSearched(true);
      setActiveQuery(query);
      setRankingNote(null);

      const cacheKey = `${query.toLowerCase()}::${maxResults}::${yearFrom}::${[...selectedCategories].sort().join(",")}`;
      const cached = searchCacheRef.current.get(cacheKey);
      if (cached) {
        if (abortRef.current !== controller) return;
        setResults(cached.results ?? []);
        setRankingNote(cached.ranking_note ?? null);
        setExpandedAbstracts({});
        setSummaryById({});
        setIsLoading(false);
        return;
      }

      try {
        const filters: { date_from?: string; categories?: string[] } = {};
        if (yearFrom > MIN_YEAR) {
          filters.date_from = `${yearFrom}-01-01`;
        }
        if (selectedCategories.length > 0) {
          filters.categories = selectedCategories;
        }

        const payload: {
          query: string;
          max_results: number;
          filters: { date_from?: string; categories?: string[] };
        } = {
          query,
          max_results: maxResults,
          filters,
        };

        const response = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (controller.signal.aborted || abortRef.current !== controller) return;

        if (!response.ok) {
          const status = response.status;
          if (status === 503) {
            throw new Error(
              "arXiv is currently unavailable. Please try again in a moment.",
            );
          }
          throw new Error("Search failed. Please try again.");
        }

        const data = (await response.json()) as SearchResponse;
        if (controller.signal.aborted || abortRef.current !== controller) return;

        if (searchCacheRef.current.size >= 20) {
          const firstKey = searchCacheRef.current.keys().next().value;
          if (firstKey) searchCacheRef.current.delete(firstKey);
        }
        searchCacheRef.current.set(cacheKey, data);

        setResults(data.results ?? []);
        setRankingNote(data.ranking_note ?? null);
        setExpandedAbstracts({});
        setSummaryById({});
      } catch (error) {
        if (controller.signal.aborted || abortRef.current !== controller || (error as Error)?.name === "AbortError") return;
        setResults([]);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Something went wrong while searching. Please retry.",
        );
      } finally {
        if (abortRef.current === controller) {
          setIsLoading(false);
        }
      }
    },
    [queryInput, maxResults, yearFrom, selectedCategories],
  );

  // ── Synthesis ─────────────────────────────────────────────────────────────

  async function generateSynthesis() {
    const synthesisQuery = activeQuery.trim();
    const topArxivIds = results.slice(0, 5).map((paper) => paper.arxiv_id);
    const topPapers = results.slice(0, 5);

    if (!synthesisQuery || topArxivIds.length === 0) {
      setSynthesisError("Run a search with results before generating synthesis.");
      return;
    }

    // Cancel previous synthesis if running.
    synthesisAbortRef.current?.abort();
    const controller = new AbortController();
    synthesisAbortRef.current = controller;

    setSynthesisText("");
    setSynthesisSources([]);
    setSynthesisValidation(null);
    setSynthesisError(null);
    setIsSynthesizing(true);
    setIsSynthesisComplete(false);
    setCopyLabel("Copy");

    let onAbort: (() => void) | null = null;

    try {
      const response = await fetch("/api/search/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: synthesisQuery,
          arxiv_ids: topArxivIds,
          // Pass paper data to avoid re-fetching from arXiv in the backend.
          papers: topPapers,
        }),
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      if (!response.ok) {
        throw new Error("Could not generate synthesis right now.");
      }

      if (!response.body) {
        throw new Error("Streaming is not supported in this browser.");
      }

      const reader = response.body.getReader();
      onAbort = () => {
        try {
          reader.cancel();
        } catch {}
      };
      controller.signal.addEventListener("abort", onAbort);
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (controller.signal.aborted || synthesisAbortRef.current !== controller) {
          reader.cancel();
          return;
        }
        if (done) break;

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
              const content = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
              dataLines.push(content);
            }
          }

          const data = dataLines.join("\n");

          if (eventType === "sources") {
            try {
              const parsed = JSON.parse(data) as SynthesisSource[];
              setSynthesisSources(parsed);
            } catch {
              // ignore malformed source payload
            }
            boundaryIndex = buffer.indexOf("\n\n");
            continue;
          }

          if (eventType === "validation") {
            try {
              const parsed = JSON.parse(data) as SynthesisValidation;
              setSynthesisValidation(parsed);
            } catch {
              // ignore malformed validation payload
            }
            boundaryIndex = buffer.indexOf("\n\n");
            continue;
          }

          if (eventType === "done") {
            if (synthesisAbortRef.current === controller) {
              setIsSynthesizing(false);
              setIsSynthesisComplete(true);
            }
            return;
          }

          if (eventType === "error") {
            throw new Error(data || "Synthesis unavailable.");
          }

          if (dataLines.length > 0) {
            setSynthesisText((current) => current + data);
          }

          boundaryIndex = buffer.indexOf("\n\n");
        }
      }

      if (buffer.length > 0 && !controller.signal.aborted && synthesisAbortRef.current === controller) {
        let eventType = "message";
        const dataLines: string[] = [];
        for (const rawLine of buffer.split("\n")) {
          const line = rawLine.replace(/\r$/, "");
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            const content = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
            dataLines.push(content);
          }
        }
        const data = dataLines.join("\n");
        if (eventType === "sources") {
          try {
            setSynthesisSources(JSON.parse(data) as SynthesisSource[]);
          } catch {}
        } else if (eventType === "validation") {
          try {
            setSynthesisValidation(JSON.parse(data) as SynthesisValidation);
          } catch {}
        } else if (eventType === "done") {
          setIsSynthesizing(false);
          setIsSynthesisComplete(true);
          return;
        } else if (eventType === "error") {
          throw new Error(data || "Synthesis unavailable.");
        } else if (dataLines.length > 0) {
          setSynthesisText((current) => current + data);
        }
      }

      if (synthesisAbortRef.current === controller) {
        setIsSynthesisComplete(true);
      }
    } catch (error) {
      if (controller.signal.aborted || synthesisAbortRef.current !== controller || (error as Error)?.name === "AbortError") return;
      setSynthesisError(
        error instanceof Error ? error.message : "Synthesis unavailable.",
      );
    } finally {
      if (onAbort) {
        controller.signal.removeEventListener("abort", onAbort);
      }
      if (!controller.signal.aborted && synthesisAbortRef.current === controller) {
        setIsSynthesizing(false);
      }
    }
  }

  function cancelSynthesis() {
    synthesisAbortRef.current?.abort();
    setIsSynthesizing(false);
  }

  async function copySynthesis() {
    if (!synthesisText) return;
    try {
      await navigator.clipboard.writeText(synthesisText);
      setCopyLabel("Copied!");
      window.setTimeout(() => setCopyLabel("Copy"), 1500);
    } catch {
      setCopyLabel("Copy failed");
      window.setTimeout(() => setCopyLabel("Copy"), 1500);
    }
  }

  // ── Paper Comparison ──────────────────────────────────────────────────────

  function toggleComparePaper(paperId: string) {
    setSelectedForCompare((current) => {
      if (current.includes(paperId)) {
        return current.filter((id) => id !== paperId);
      }
      if (current.length >= 4) {
        return current;
      }
      return [...current, paperId];
    });
  }

  async function generateComparison(idsToCompare?: string[]) {
    const targetIds = idsToCompare ?? (
      selectedForCompare.length >= 2
        ? selectedForCompare
        : results.slice(0, 3).map((p) => p.arxiv_id)
    );

    if (targetIds.length < 2) {
      setComparisonError("Select at least 2 papers to generate a comparison.");
      setShowComparisonView(true);
      return;
    }

    const boundedIds = targetIds.slice(0, 4);

    if (
      comparisonResult &&
      comparisonResult.papers.length === boundedIds.length &&
      boundedIds.every((id) => comparisonResult.papers.some((p) => p.arxiv_id === id)) &&
      !comparisonError
    ) {
      setShowComparisonView(true);
      return;
    }

    const selectedPapers = results.filter((p) => boundedIds.includes(p.arxiv_id));

    // Cancel any previous in-flight comparison.
    comparisonAbortRef.current?.abort();
    const controller = new AbortController();
    comparisonAbortRef.current = controller;

    setIsComparing(true);
    setComparisonError(null);
    setShowComparisonView(true);

    try {
      const response = await fetch("/api/papers/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          arxiv_ids: boundedIds,
          papers: selectedPapers,
          query: activeQuery,
        }),
        signal: controller.signal,
      });

      if (controller.signal.aborted || comparisonAbortRef.current !== controller) return;

      if (!response.ok) {
        let msg = "Could not generate comparison right now.";
        try {
          const errData = await response.json();
          if (errData?.detail) {
            msg = typeof errData.detail === "string" ? errData.detail : JSON.stringify(errData.detail);
          }
        } catch {}
        throw new Error(msg);
      }

      const data = (await response.json()) as ComparisonResult;
      if (controller.signal.aborted || comparisonAbortRef.current !== controller) return;
      setComparisonResult(data);
    } catch (error) {
      if (controller.signal.aborted || comparisonAbortRef.current !== controller || (error as Error)?.name === "AbortError") return;
      setComparisonError(
        error instanceof Error ? error.message : "Failed to generate comparison. Please retry.",
      );
    } finally {
      if (comparisonAbortRef.current === controller) {
        setIsComparing(false);
      }
    }
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  async function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch();
  }

  function handleExampleClick(example: string) {
    setQueryInput(example);
    // Fill input but don't auto-submit — user may want to adjust filters first.
  }

  function toggleCategory(category: string) {
    setSelectedCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
  }

  function resetFilters() {
    setYearFrom(MIN_YEAR);
    setSelectedCategories([]);
    setMaxResults(10);
  }

  function toggleAbstract(arxivId: string) {
    setExpandedAbstracts((current) => ({
      ...current,
      [arxivId]: !current[arxivId],
    }));
  }

  function toggleGraphSelection(arxivId: string) {
    setSelectedForGraph((current) =>
      current.includes(arxivId)
        ? current.filter((id) => id !== arxivId)
        : [...current, arxivId],
    );
  }

  function toggleSavedPaper(paper: PaperResult) {
    setReadingList((current) => {
      let updated: ReadingListEntry[];
      if (current.some((e) => e.arxiv_id === paper.arxiv_id)) {
        updated = current.filter((e) => e.arxiv_id !== paper.arxiv_id);
      } else {
        updated = [
          ...current,
          {
            arxiv_id: paper.arxiv_id,
            title: paper.title,
            authors: paper.authors,
            published: paper.published,
            pdf_url: paper.pdf_url,
            entry_url: paper.entry_url,
            savedAt: new Date().toISOString(),
          },
        ];
      }
      saveReadingList(updated);
      return updated;
    });
  }

  async function summarizePaper(arxivId: string) {
    const existing = summaryById[arxivId];
    if (existing?.loading) return;
    if (existing?.summary && !existing.error) {
      setSummaryById((current) => ({
        ...current,
        [arxivId]: { ...current[arxivId], open: !current[arxivId]?.open },
      }));
      return;
    }

    setSummaryById((current) => ({
      ...current,
      [arxivId]: { ...current[arxivId], open: true, loading: true, error: undefined },
    }));

    const paper = results.find((p) => p.arxiv_id === arxivId);

    try {
      const response = await fetch(
        `/api/papers/${encodeURIComponent(arxivId)}/summarize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: paper?.title,
            abstract: paper?.abstract,
          }),
        },
      );

      if (!response.ok) {
        let msg = "Summary unavailable right now.";
        try {
          const errData = await response.json();
          if (errData?.detail) {
            msg = typeof errData.detail === "string" ? errData.detail : JSON.stringify(errData.detail);
          }
        } catch {
          // fallback to generic
        }
        throw new Error(msg);
      }

      const data = (await response.json()) as { arxiv_id: string; summary: string };
      setSummaryById((current) => ({
        ...current,
        [arxivId]: { loading: false, open: true, summary: data.summary, error: undefined },
      }));
    } catch (error) {
      setSummaryById((current) => ({
        ...current,
        [arxivId]: {
          loading: false,
          open: true,
          summary: undefined,
          error: error instanceof Error ? error.message : "Summary unavailable.",
        },
      }));
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const showEmptyPrompt = !hasSearched && !isLoading && !errorMessage;
  const showNoResults = !isLoading && !errorMessage && hasSearched && results.length === 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Reading list overlay */}
      {showReadingList && (
        <>
          <div
            className="fixed inset-0 z-30"
            style={{ backgroundColor: "rgba(5,13,26,0.7)" }}
            onClick={() => setShowReadingList(false)}
            aria-hidden="true"
          />
          <ReadingListPanel
            list={readingList}
            onRemove={(id) => {
              setReadingList((current) => {
                const updated = current.filter((e) => e.arxiv_id !== id);
                saveReadingList(updated);
                return updated;
              });
            }}
            onClear={() => {
              setReadingList([]);
              saveReadingList([]);
            }}
            onClose={() => setShowReadingList(false)}
          />
        </>
      )}

      <main
        className="min-h-screen"
        style={{ backgroundColor: "var(--bg-page)", color: "var(--text-primary)" }}
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">

          {/* ── Header ──────────────────────────────────────────────────── */}
          <header
            className="mb-10 flex flex-wrap items-center justify-between gap-3 rounded-[18px] p-4"
            style={{
              border: "1px solid var(--border-default)",
              backgroundColor: "var(--bg-surface)",
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-xl"
                style={{ backgroundColor: "var(--cyan-subtle)", border: "1px solid rgba(6,182,212,0.3)" }}
                aria-hidden="true"
              >
                <span style={{ color: "var(--text-accent)", fontSize: "1.1rem" }}>⬡</span>
              </div>
              <div>
                <h1
                  className="text-xl font-bold tracking-tight sm:text-2xl"
                  style={{ color: "var(--text-primary)" }}
                >
                  Scholytics
                </h1>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  Semantic paper discovery &amp; synthesis
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Reading list button */}
              <button
                type="button"
                onClick={() => setShowReadingList(true)}
                className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors hover:opacity-80"
                style={{
                  border: "1px solid var(--border-default)",
                  backgroundColor: "var(--bg-elevated)",
                  color: "var(--text-secondary)",
                }}
                aria-label={`Reading list (${readingList.length} saved)`}
              >
                <span aria-hidden="true">📚</span>
                <span className="hidden sm:inline">Saved</span>
                {readingList.length > 0 && (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-xs font-bold"
                    style={{
                      backgroundColor: "var(--cyan-subtle)",
                      color: "var(--text-accent)",
                    }}
                  >
                    {readingList.length}
                  </span>
                )}
              </button>

              {/* Graph button */}
              <Link
                href={graphHref}
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors hover:opacity-90"
                style={{
                  backgroundColor: "var(--cyan-primary)",
                  color: "var(--cyan-text)",
                }}
                aria-label={`Open research graph (${selectedGraphCount} papers selected)`}
              >
                <span aria-hidden="true">◈</span>
                <span>Graph</span>
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-bold"
                  style={{ backgroundColor: "rgba(0,0,0,0.2)", color: "inherit" }}
                >
                  {selectedGraphCount}
                </span>
              </Link>
            </div>
          </header>

          {/* ── Hero + Search ────────────────────────────────────────────── */}
          <section className="mx-auto max-w-4xl text-center">
            <h2
              className="text-4xl font-extrabold tracking-tight sm:text-5xl"
              style={{ color: "var(--text-primary)" }}
            >
              Discover Research{" "}
              <span style={{ color: "var(--text-accent)" }}>Faster</span>
            </h2>
            <p
              className="mx-auto mt-4 max-w-2xl text-base sm:text-lg"
              style={{ color: "var(--text-secondary)" }}
            >
              Search live arXiv papers, generate summaries, synthesize topics, and
              explore paper relationships — all in one workflow.
            </p>

            {/* Example queries */}
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {EXAMPLE_QUERIES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => handleExampleClick(example)}
                  className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
                  style={{
                    border: "1px solid var(--border-default)",
                    backgroundColor: "var(--bg-elevated)",
                    color: "var(--text-secondary)",
                  }}
                  aria-label={`Fill search with: ${example}`}
                >
                  {example}
                </button>
              ))}
            </div>

            {/* Search form */}
            <form onSubmit={handleSearchSubmit} className="mt-6" role="search">
              <div className="flex flex-col gap-3 sm:flex-row">
                <label htmlFor="search-input" className="sr-only">
                  Search arXiv research papers
                </label>
                <input
                  id="search-input"
                  value={queryInput}
                  onChange={(event) => setQueryInput(event.target.value)}
                  placeholder="Search arXiv topics, methods, or questions…"
                  maxLength={400}
                  autoComplete="off"
                  className="h-12 w-full flex-1 rounded-xl px-4 text-base transition-all"
                  style={{
                    border: "1px solid var(--border-default)",
                    backgroundColor: "var(--bg-input)",
                    color: "var(--text-primary)",
                    outline: "none",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-focus)";
                    e.currentTarget.style.boxShadow = "var(--shadow-cyan)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-default)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                />
                <button
                  type="submit"
                  disabled={isLoading}
                  className="h-12 rounded-xl px-7 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--cyan-primary)",
                    color: "var(--cyan-text)",
                  }}
                  onMouseEnter={(e) => {
                    if (!isLoading)
                      e.currentTarget.style.backgroundColor = "var(--cyan-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--cyan-primary)";
                  }}
                >
                  {isLoading ? "Searching…" : "Search"}
                </button>
              </div>
            </form>
          </section>

          {/* ── Filters ──────────────────────────────────────────────────── */}
          <section
            className="mx-auto mt-6 w-full max-w-5xl rounded-[18px] p-5"
            style={{
              border: "1px solid var(--border-subtle)",
              backgroundColor: "var(--bg-surface)",
            }}
            aria-label="Search filters"
          >
            <div className="mb-3 flex items-center justify-between">
              <p
                className="text-xs font-semibold uppercase tracking-widest"
                style={{ color: "var(--text-accent-dim)" }}
              >
                Filters
                {activeFilterCount > 0 && (
                  <span
                    className="ml-2 rounded-full px-2 py-0.5 text-xs normal-case"
                    style={{
                      backgroundColor: "var(--cyan-subtle)",
                      color: "var(--text-accent)",
                    }}
                    aria-label={`${activeFilterCount} active filters`}
                  >
                    {activeFilterCount} active
                  </span>
                )}
              </p>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-xs transition-colors hover:opacity-80"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Reset filters
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              {/* Year range */}
              <div>
                <p
                  className="mb-2 text-xs font-semibold uppercase tracking-widest"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Earliest Publication Year
                </p>
                <div
                  className="mb-2 flex items-center justify-between rounded-lg px-3 py-2 text-sm"
                  style={{
                    border: "1px solid var(--border-subtle)",
                    backgroundColor: "var(--bg-elevated)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <span>From: <strong style={{ color: "var(--text-primary)" }}>{yearFrom} or later</strong></span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {yearFrom > MIN_YEAR ? "Lower bound" : `All (${MIN_YEAR}+)`}
                  </span>
                </div>
                <label htmlFor="year-range" className="sr-only">
                  Earliest publication year: {yearFrom} or later
                </label>
                <input
                  id="year-range"
                  type="range"
                  min={MIN_YEAR}
                  max={CURRENT_YEAR}
                  value={yearFrom}
                  onChange={(event) => setYearFrom(Number(event.target.value))}
                  className="w-full"
                  aria-valuemin={MIN_YEAR}
                  aria-valuemax={CURRENT_YEAR}
                  aria-valuenow={yearFrom}
                  aria-label={`Earliest publication year: ${yearFrom} or later`}
                />
              </div>

              {/* Categories */}
              <div>
                <p
                  className="mb-2 text-xs font-semibold uppercase tracking-widest"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Categories
                </p>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Research category filters">
                  {AVAILABLE_CATEGORIES.map((category) => {
                    const active = selectedCategories.includes(category);
                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() => toggleCategory(category)}
                        className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
                        style={{
                          border: active
                            ? "1px solid rgba(6,182,212,0.5)"
                            : "1px solid var(--border-subtle)",
                          backgroundColor: active
                            ? "var(--cyan-subtle)"
                            : "var(--bg-elevated)",
                          color: active ? "var(--text-accent)" : "var(--text-secondary)",
                        }}
                        aria-pressed={active}
                        aria-label={`${active ? "Remove" : "Add"} ${category} filter`}
                      >
                        {category}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Result count */}
              <div>
                <label
                  htmlFor="result-count"
                  className="mb-2 block text-xs font-semibold uppercase tracking-widest"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Result Count
                </label>
                <select
                  id="result-count"
                  value={maxResults}
                  onChange={(event) => setMaxResults(Number(event.target.value))}
                  className="h-10 w-full rounded-lg px-3 text-sm transition-all"
                  style={{
                    border: "1px solid var(--border-default)",
                    backgroundColor: "var(--bg-input)",
                    color: "var(--text-primary)",
                    outline: "none",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-focus)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-default)";
                  }}
                >
                  <option value={5}>5 papers</option>
                  <option value={10}>10 papers</option>
                  <option value={25}>25 papers</option>
                </select>
                <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                  Graph selection:{" "}
                  <span style={{ color: "var(--text-accent)" }} aria-live="polite">
                    {selectedGraphCount}
                  </span>
                </p>
              </div>
            </div>
          </section>

          {/* ── Results area ─────────────────────────────────────────────── */}
          <section className="mx-auto mt-8 w-full max-w-6xl" aria-label="Search results" aria-live="polite">

            {/* Ranking degraded note */}
            {rankingNote && !isLoading && (
              <div
                className="mb-4 rounded-xl px-4 py-3 text-sm"
                style={{
                  border: "1px solid rgba(245,158,11,0.3)",
                  backgroundColor: "rgba(245,158,11,0.07)",
                  color: "#fbbf24",
                }}
                role="alert"
              >
                ⚠ {rankingNote}
              </div>
            )}

            {/* Empty prompt */}
            {showEmptyPrompt && (
              <div
                className="grid min-h-72 place-items-center rounded-[18px] p-10 text-center"
                style={{
                  border: "1px dashed var(--border-subtle)",
                  backgroundColor: "var(--bg-surface)",
                }}
              >
                <div>
                  <div
                    className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl text-3xl"
                    style={{ backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}
                    aria-hidden="true"
                  >
                    🔭
                  </div>
                  <p className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
                    Search for any research topic
                  </p>
                  <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                    Try one of the example queries above, or type your own question.
                  </p>
                </div>
              </div>
            )}

            {/* Loading skeletons */}
            {isLoading && <SkeletonCards />}

            {/* Error state */}
            {!isLoading && errorMessage && (
              <div
                className="mx-auto max-w-3xl rounded-[18px] p-6 text-center"
                style={{
                  border: "1px solid var(--error-border)",
                  backgroundColor: "var(--error-bg)",
                }}
                role="alert"
              >
                <p className="mb-4 text-sm" style={{ color: "#fda4af" }}>
                  {errorMessage}
                </p>
                <button
                  type="button"
                  onClick={() => runSearch(activeQuery || queryInput)}
                  className="rounded-lg px-5 py-2 text-sm font-semibold transition-colors hover:opacity-80"
                  style={{ backgroundColor: "var(--error)", color: "#fff0f3" }}
                >
                  Retry
                </button>
              </div>
            )}

            {/* No results */}
            {showNoResults && (
              <div
                className="mx-auto max-w-3xl rounded-[18px] p-8 text-center"
                style={{
                  border: "1px solid var(--border-subtle)",
                  backgroundColor: "var(--bg-surface)",
                }}
                role="status"
              >
                <p className="text-lg font-medium" style={{ color: "var(--text-primary)" }}>
                  No papers found
                </p>
                <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                  Try broadening your query, reducing the year filter, or removing category filters.
                </p>
              </div>
            )}

            {/* Results */}
            {!isLoading && !errorMessage && results.length > 0 && (
              <div className="space-y-6">

                {/* Synthesis panel */}
                <div
                  className="rounded-[18px] p-6"
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
                        Synthesises the top {Math.min(results.length, 5)} results using Groq · abstract-based only
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isSynthesizing && (
                        <button
                          type="button"
                          onClick={cancelSynthesis}
                          className="rounded-xl px-4 py-2 text-sm font-semibold transition-colors hover:opacity-80"
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
                        onClick={generateSynthesis}
                        disabled={isSynthesizing}
                        className="rounded-xl px-4 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
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
                        aria-label={isSynthesizing ? "Generating synthesis…" : "Generate topic synthesis"}
                      >
                        {isSynthesizing ? "Generating…" : "Generate Synthesis"}
                      </button>

                      <button
                        type="button"
                        onClick={() => generateComparison()}
                        disabled={isComparing || results.length < 2}
                        className="rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        style={
                          selectedForCompare.length >= 2
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
                          : selectedForCompare.length >= 2
                          ? `Compare (${selectedForCompare.length})`
                          : "Compare Top 3"}
                      </button>
                    </div>
                  </div>

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

                  {(synthesisText || isSynthesizing) && (
                    <div
                      className="rounded-xl p-4"
                      style={{
                        border: "1px solid var(--border-subtle)",
                        backgroundColor: "var(--bg-page)",
                      }}
                    >
                      <div className="synthesis-prose text-sm">
                        <ReactMarkdown>{synthesisText}</ReactMarkdown>
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

                  {/* Grounding Sources & Attribution Validation */}
                  {synthesisSources.length > 0 && (synthesisText || isSynthesizing) && (
                    <div
                      className="mt-3 rounded-xl p-3.5 text-xs"
                      style={{
                        border: "1px solid var(--border-subtle)",
                        backgroundColor: "var(--bg-elevated)",
                      }}
                    >
                      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-xs tracking-wide uppercase" style={{ color: "var(--text-secondary)" }}>
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

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {synthesisSources.map((source) => {
                          const isCited = synthesisValidation?.cited_sources.includes(source.source_index);
                          return (
                            <div
                              key={source.arxiv_id}
                              className="flex flex-col justify-between rounded-lg p-2.5 transition-colors"
                              style={{
                                border: isCited
                                  ? "1px solid rgba(6,182,212,0.4)"
                                  : "1px solid var(--border-subtle)",
                                backgroundColor: isCited
                                  ? "rgba(6,182,212,0.06)"
                                  : "var(--bg-page)",
                              }}
                            >
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
                                    className="text-[10px] font-medium"
                                    style={{ color: "var(--text-accent)" }}
                                  >
                                    Cited
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
                              <div
                                className="mt-2 flex items-center justify-between text-[11px]"
                                style={{ color: "var(--text-muted)" }}
                              >
                                <span>
                                  {source.authors.length > 0
                                    ? `${source.authors[0]}${source.authors.length > 1 ? " et al." : ""}`
                                    : source.arxiv_id}
                                </span>
                                <div className="flex gap-2">
                                  {source.pdf_url && (
                                    <a
                                      href={source.pdf_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-medium hover:underline"
                                      style={{ color: "var(--text-accent)" }}
                                    >
                                      PDF ↗
                                    </a>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <p className="mt-2.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                        ⚠ Grounding Guarantee: Citations are cross-referenced against the retrieved candidate papers.
                        Does not perform automated laboratory fact verification.
                      </p>
                    </div>
                  )}

                  {isSynthesisComplete && synthesisText && (
                    <div className="mt-3 flex items-center gap-2">
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        ⚠ Generated from abstracts only — verify claims in original papers.
                      </p>
                      <button
                        type="button"
                        onClick={copySynthesis}
                        className="ml-auto rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors hover:opacity-80"
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

                {/* Structured Paper Comparison Section */}
                {showComparisonView && (
                  <div
                    className="mb-6 rounded-2xl p-5 sm:p-6 transition-all"
                    style={{
                      border: "1px solid var(--border-default)",
                      backgroundColor: "var(--bg-card)",
                      boxShadow: "0 10px 30px -10px rgba(0,0,0,0.4)",
                    }}
                  >
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--border-subtle)" }}>
                      <div>
                        <h3 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
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
                          onClick={() => setShowComparisonView(false)}
                          className="rounded-lg px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-80"
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
                      <div className="py-8 text-center">
                        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                        <p className="mt-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
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
                            onClick={() => generateComparison()}
                            className="rounded-lg px-3 py-1.5 text-xs font-bold transition-opacity hover:opacity-80"
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
                              <tr style={{ backgroundColor: "var(--bg-elevated)", borderBottom: "1px solid var(--border-subtle)" }}>
                                <th className="w-36 p-3 font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                                  Dimension
                                </th>
                                {comparisonResult.papers.map((p, idx) => (
                                  <th
                                    key={p.arxiv_id}
                                    className="p-3 font-semibold"
                                    style={{
                                      color: "var(--text-primary)",
                                      borderLeft: idx > 0 ? "1px solid var(--border-subtle)" : undefined,
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
                                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                                        {p.published ? p.published.slice(0, 4) : ""} · {p.authors.length > 0 ? `${p.authors[0]} et al.` : ""}
                                      </span>
                                    </div>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {/* Row 1: Objective */}
                              <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                                <td className="p-3 font-semibold align-top" style={{ color: "var(--text-secondary)", backgroundColor: "rgba(0,0,0,0.1)" }}>
                                  Objective
                                </td>
                                {comparisonResult.papers.map((p, idx) => (
                                  <td
                                    key={p.arxiv_id}
                                    className="p-3 leading-relaxed align-top"
                                    style={{
                                      color: "var(--text-primary)",
                                      borderLeft: idx > 0 ? "1px solid var(--border-subtle)" : undefined,
                                    }}
                                  >
                                    {p.research_question}
                                  </td>
                                ))}
                              </tr>

                              {/* Row 2: Method */}
                              <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                                <td className="p-3 font-semibold align-top" style={{ color: "var(--text-secondary)", backgroundColor: "rgba(0,0,0,0.1)" }}>
                                  Proposed Method
                                </td>
                                {comparisonResult.papers.map((p, idx) => (
                                  <td
                                    key={p.arxiv_id}
                                    className="p-3 leading-relaxed align-top"
                                    style={{
                                      color: "var(--text-primary)",
                                      borderLeft: idx > 0 ? "1px solid var(--border-subtle)" : undefined,
                                    }}
                                  >
                                    {p.method}
                                  </td>
                                ))}
                              </tr>

                              {/* Row 3: Datasets & Setup */}
                              <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                                <td className="p-3 font-semibold align-top" style={{ color: "var(--text-secondary)", backgroundColor: "rgba(0,0,0,0.1)" }}>
                                  Datasets / Setup
                                </td>
                                {comparisonResult.papers.map((p, idx) => (
                                  <td
                                    key={p.arxiv_id}
                                    className="p-3 leading-relaxed align-top"
                                    style={{
                                      color: p.datasets_or_setup.includes("Not explicitly") ? "var(--text-muted)" : "var(--text-primary)",
                                      borderLeft: idx > 0 ? "1px solid var(--border-subtle)" : undefined,
                                    }}
                                  >
                                    {p.datasets_or_setup}
                                  </td>
                                ))}
                              </tr>

                              {/* Row 4: Findings */}
                              <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                                <td className="p-3 font-semibold align-top" style={{ color: "var(--text-secondary)", backgroundColor: "rgba(0,0,0,0.1)" }}>
                                  Reported Findings
                                </td>
                                {comparisonResult.papers.map((p, idx) => (
                                  <td
                                    key={p.arxiv_id}
                                    className="p-3 leading-relaxed align-top"
                                    style={{
                                      color: "var(--text-primary)",
                                      borderLeft: idx > 0 ? "1px solid var(--border-subtle)" : undefined,
                                    }}
                                  >
                                    {p.reported_findings}
                                  </td>
                                ))}
                              </tr>

                              {/* Row 5: Limitations */}
                              <tr>
                                <td className="p-3 font-semibold align-top" style={{ color: "var(--text-secondary)", backgroundColor: "rgba(0,0,0,0.1)" }}>
                                  Author Limitations
                                </td>
                                {comparisonResult.papers.map((p, idx) => (
                                  <td
                                    key={p.arxiv_id}
                                    className="p-3 leading-relaxed align-top"
                                    style={{
                                      color: p.limitations.includes("Not explicitly") ? "var(--text-muted)" : "#f87171",
                                      borderLeft: idx > 0 ? "1px solid var(--border-subtle)" : undefined,
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
                            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-accent)" }}>
                              Similarities & Consensus
                            </h4>
                            <ul className="space-y-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                              {comparisonResult.similarities.length > 0 ? (
                                comparisonResult.similarities.map((item, i) => (
                                  <li key={i} className="flex items-start gap-1.5">
                                    <span style={{ color: "var(--text-accent)" }}>•</span>
                                    <span>{item}</span>
                                  </li>
                                ))
                              ) : (
                                <li className="text-[11px]" style={{ color: "var(--text-muted)" }}>
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
                            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider" style={{ color: "#818cf8" }}>
                              Methodological Differences
                            </h4>
                            <ul className="space-y-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                              {comparisonResult.differences.length > 0 ? (
                                comparisonResult.differences.map((item, i) => (
                                  <li key={i} className="flex items-start gap-1.5">
                                    <span style={{ color: "#818cf8" }}>•</span>
                                    <span>{item}</span>
                                  </li>
                                ))
                              ) : (
                                <li className="text-[11px]" style={{ color: "var(--text-muted)" }}>
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
                              <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: "#fbbf24" }}>
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
                            <ul className="space-y-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                              {comparisonResult.research_gaps.length > 0 ? (
                                comparisonResult.research_gaps.map((item, i) => (
                                  <li key={i} className="flex items-start gap-1.5">
                                    <span style={{ color: "#fbbf24" }}>•</span>
                                    <span>{item}</span>
                                  </li>
                                ))
                              ) : (
                                <li className="text-[11px]" style={{ color: "var(--text-muted)" }}>
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
                )}

                {/* Result count + graph prompt */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                    <span
                      className="font-semibold"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {results.length}
                    </span>{" "}
                    papers · ranked by cosine similarity to query
                  </p>
                  {selectedGraphCount > 0 && (
                    <Link
                      href={graphHref}
                      className="rounded-full px-3 py-1 text-xs font-semibold transition-colors hover:opacity-80"
                      style={{
                        backgroundColor: "var(--cyan-subtle)",
                        color: "var(--text-accent)",
                        border: "1px solid rgba(6,182,212,0.3)",
                      }}
                    >
                      Open graph ({selectedGraphCount}) →
                    </Link>
                  )}
                </div>

                {/* Paper cards */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {results.map((paper) => {
                    const score = clampScore(paper.relevance_score);
                    const summaryState = summaryById[paper.arxiv_id];
                    const abstractExpanded = !!expandedAbstracts[paper.arxiv_id];
                    const inGraph = normalizedSelectedForGraph.includes(paper.arxiv_id);
                    const isSaved = savedIds.has(paper.arxiv_id);
                    const inCompare = selectedForCompare.includes(paper.arxiv_id);

                    return (
                      <article
                        key={paper.arxiv_id}
                        className="flex flex-col rounded-[18px] p-5 transition-all"
                        style={{
                          border: inGraph
                            ? "1px solid rgba(6,182,212,0.4)"
                            : "1px solid var(--border-subtle)",
                          backgroundColor: "var(--bg-surface)",
                        }}
                        aria-label={`Paper: ${paper.title}`}
                      >
                        {/* Title */}
                        <h4
                          className="mb-2 line-clamp-2 text-base font-semibold leading-snug"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {paper.title}
                        </h4>

                        {/* Authors */}
                        <p
                          className="mb-1 line-clamp-1 text-xs"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {paper.authors.slice(0, 4).join(", ") ||
                            "Unknown authors"}
                          {paper.authors.length > 4 &&
                            ` +${paper.authors.length - 4} more`}
                        </p>

                        {/* Date + ID */}
                        <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
                          {formatDate(paper.published)} ·{" "}
                          <a
                            href={paper.entry_url}
                            target="_blank"
                            rel="noreferrer"
                            className="transition-colors hover:opacity-80"
                            style={{ color: "var(--text-accent-dim)" }}
                            aria-label={`arXiv abstract for ${paper.arxiv_id}`}
                          >
                            {paper.arxiv_id}
                          </a>
                        </p>

                        {/* Categories */}
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          {paper.categories.slice(0, 4).map((category) => (
                            <span
                              key={`${paper.arxiv_id}-${category}`}
                              className="rounded-full px-2 py-0.5 text-xs"
                              style={{
                                border: "1px solid var(--border-subtle)",
                                backgroundColor: "var(--bg-elevated)",
                                color: "var(--text-secondary)",
                              }}
                            >
                              {category}
                            </span>
                          ))}
                        </div>

                        {/* Relevance bar */}
                        {paper.relevance_score !== null && !paper.ranking_degraded && (
                          <div className="mb-3">
                            <div
                              className="mb-1 flex items-center justify-between text-xs"
                              style={{ color: "var(--text-muted)" }}
                            >
                              <span>Cosine similarity</span>
                              <span
                                className="font-mono font-semibold"
                                style={{ color: "var(--text-accent)" }}
                              >
                                {(score * 100).toFixed(1)}%
                              </span>
                            </div>
                            <div
                              className="h-1.5 overflow-hidden rounded-full"
                              style={{ backgroundColor: "var(--bg-elevated)" }}
                              role="meter"
                              aria-label={`Relevance: ${(score * 100).toFixed(1)}%`}
                              aria-valuenow={Math.round(score * 100)}
                              aria-valuemin={0}
                              aria-valuemax={100}
                            >
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${(score * 100).toFixed(1)}%`,
                                  background: `linear-gradient(90deg, var(--cyan-dim), var(--cyan-primary))`,
                                }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Abstract */}
                        <div className="mb-3 flex-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                          <p
                            className={
                              abstractExpanded
                                ? "leading-6"
                                : "line-clamp-3 leading-6"
                            }
                          >
                            {paper.abstract}
                          </p>
                          {paper.abstract.length > 200 && (
                            <button
                              type="button"
                              onClick={() => toggleAbstract(paper.arxiv_id)}
                              className="mt-1 text-xs font-medium transition-colors hover:opacity-80"
                              style={{ color: "var(--text-accent)" }}
                              aria-expanded={abstractExpanded}
                              aria-controls={`abstract-${paper.arxiv_id}`}
                            >
                              {abstractExpanded ? "Show less" : "Read more"}
                            </button>
                          )}
                        </div>

                        {/* Action buttons */}
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => summarizePaper(paper.arxiv_id)}
                            disabled={summaryState?.loading}
                            className="rounded-lg px-3 py-1.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                            style={{
                              backgroundColor: "var(--cyan-primary)",
                              color: "var(--cyan-text)",
                            }}
                            onMouseEnter={(e) => {
                              if (!summaryState?.loading)
                                e.currentTarget.style.backgroundColor = "var(--cyan-hover)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = "var(--cyan-primary)";
                            }}
                            aria-label={
                              summaryState?.loading
                                ? "Generating summary…"
                                : `Summarize: ${paper.title}`
                            }
                          >
                            {summaryState?.loading ? "Summarizing…" : "Summarize"}
                          </button>

                          <button
                            type="button"
                            onClick={() => toggleGraphSelection(paper.arxiv_id)}
                            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                            style={
                              inGraph
                                ? {
                                    backgroundColor: "rgba(16,185,129,0.12)",
                                    border: "1px solid rgba(16,185,129,0.4)",
                                    color: "#34d399",
                                  }
                                : {
                                    border: "1px solid var(--border-subtle)",
                                    backgroundColor: "var(--bg-elevated)",
                                    color: "var(--text-secondary)",
                                  }
                            }
                            aria-pressed={inGraph}
                            aria-label={
                              inGraph
                                ? `Remove ${paper.title} from graph`
                                : `Add ${paper.title} to graph`
                            }
                          >
                            {inGraph ? "✓ In Graph" : "Add to Graph"}
                          </button>

                          <button
                            type="button"
                            onClick={() => toggleComparePaper(paper.arxiv_id)}
                            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                            style={
                              inCompare
                                ? {
                                    backgroundColor: "rgba(6,182,212,0.18)",
                                    border: "1px solid rgba(6,182,212,0.45)",
                                    color: "var(--text-accent)",
                                  }
                                : {
                                    border: "1px solid var(--border-subtle)",
                                    backgroundColor: "var(--bg-elevated)",
                                    color: "var(--text-secondary)",
                                  }
                            }
                            aria-pressed={inCompare}
                            aria-label={
                              inCompare
                                ? `Remove ${paper.title} from comparison`
                                : `Add ${paper.title} to comparison`
                            }
                          >
                            {inCompare ? "✓ In Compare" : "+ Compare"}
                          </button>

                          <button
                            type="button"
                            onClick={() => toggleSavedPaper(paper)}
                            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                            style={
                              isSaved
                                ? {
                                    backgroundColor: "rgba(245,158,11,0.1)",
                                    border: "1px solid rgba(245,158,11,0.35)",
                                    color: "#fbbf24",
                                  }
                                : {
                                    border: "1px solid var(--border-subtle)",
                                    backgroundColor: "var(--bg-elevated)",
                                    color: "var(--text-secondary)",
                                  }
                            }
                            aria-pressed={isSaved}
                            aria-label={
                              isSaved
                                ? `Remove ${paper.title} from reading list`
                                : `Save ${paper.title} to reading list`
                            }
                          >
                            {isSaved ? "★ Saved" : "Save"}
                          </button>

                          <a
                            href={paper.pdf_url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors hover:opacity-80"
                            style={{
                              border: "1px solid var(--border-subtle)",
                              backgroundColor: "var(--bg-elevated)",
                              color: "var(--text-secondary)",
                            }}
                            aria-label={`Open PDF for: ${paper.title}`}
                          >
                            PDF ↗
                          </a>
                        </div>

                        {/* Summary panel */}
                        {summaryState?.open && (
                          <div
                            className="mt-3 rounded-xl p-3"
                            style={{
                              border: "1px solid rgba(6,182,212,0.2)",
                              backgroundColor: "var(--bg-page)",
                            }}
                            role="region"
                            aria-label={`AI summary for ${paper.title}`}
                          >
                            {summaryState.loading && (
                              <p
                                className="text-xs"
                                style={{ color: "var(--text-accent)" }}
                                aria-live="polite"
                              >
                                Generating summary…
                              </p>
                            )}
                            {!summaryState.loading && summaryState.error && (
                              <div className="flex flex-col items-start gap-2">
                                <p className="text-xs" style={{ color: "#fda4af" }} role="alert">
                                  {summaryState.error}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => summarizePaper(paper.arxiv_id)}
                                  disabled={summaryState.loading}
                                  className="rounded-md px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                                  style={{
                                    backgroundColor: "rgba(239,68,68,0.15)",
                                    border: "1px solid rgba(239,68,68,0.35)",
                                    color: "#fca5a5",
                                  }}
                                  aria-label={`Retry summary for ${paper.title}`}
                                >
                                  Retry
                                </button>
                              </div>
                            )}
                            {!summaryState.loading &&
                              !summaryState.error &&
                              summaryState.summary && (
                                <div>
                                  <p
                                    className="mb-1.5 text-xs font-bold uppercase tracking-widest"
                                    style={{ color: "var(--text-accent-dim)" }}
                                  >
                                    AI Summary
                                  </p>
                                  <p
                                    className="text-xs leading-6"
                                    style={{ color: "var(--text-secondary)" }}
                                  >
                                    {summaryState.summary}
                                  </p>
                                  <p
                                    className="mt-2 text-xs"
                                    style={{ color: "var(--text-muted)" }}
                                  >
                                    ⚠ Based on abstract only — not the full paper.
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
    </>
  );
}
