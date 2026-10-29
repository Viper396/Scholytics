"use client";

import React, {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import PaperCard, { PaperResult } from "../components/PaperCard";
import SynthesisPanel, {
  SynthesisSource,
  SynthesisValidation,
} from "../components/SynthesisPanel";
import ComparisonMatrix, { ComparisonResult } from "../components/ComparisonMatrix";

// ─── Types ────────────────────────────────────────────────────────────────────

type SearchResponse = {
  query: string;
  results: PaperResult[];
  total: number;
  ranking_note?: string | null;
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

// ─── Constants ────────────────────────────────────────────────────────────────

const AVAILABLE_CATEGORIES = [
  "cs.AI",
  "cs.CL",
  "cs.CV",
  "cs.LG",
  "cs.RO",
  "stat.ML",
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

// ─── Storage Helpers ──────────────────────────────────────────────────────────

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
        typeof (item as ReadingListEntry).arxiv_id === "string" &&
        typeof (item as ReadingListEntry).title === "string",
    );
  } catch {
    return [];
  }
}

function saveReadingList(list: ReadingListEntry[]) {
  try {
    window.localStorage.setItem(READING_LIST_STORAGE_KEY, JSON.stringify(list));
  } catch {}
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SkeletonCards() {
  return (
    <div
      className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
      role="status"
      aria-label="Loading search results"
    >
      {Array.from({ length: 6 }).map((_, idx) => (
        <div
          key={idx}
          className="animate-pulse rounded-[18px] p-5"
          style={{
            border: "1px solid var(--border-subtle)",
            backgroundColor: "var(--bg-surface)",
          }}
        >
          <div
            className="mb-3 h-4 w-1/3 rounded-full"
            style={{ backgroundColor: "var(--bg-elevated)" }}
          />
          <div
            className="mb-2 h-5 w-4/5 rounded"
            style={{ backgroundColor: "var(--bg-elevated)" }}
          />
          <div
            className="mb-4 h-3.5 w-1/2 rounded"
            style={{ backgroundColor: "var(--bg-elevated)" }}
          />
          <div
            className="mb-2 h-3 w-full rounded"
            style={{ backgroundColor: "var(--bg-elevated)" }}
          />
          <div
            className="mb-2 h-3 w-5/6 rounded"
            style={{ backgroundColor: "var(--bg-elevated)" }}
          />
          <div
            className="h-3 w-3/4 rounded"
            style={{ backgroundColor: "var(--bg-elevated)" }}
          />
        </div>
      ))}
    </div>
  );
}

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
    <aside
      role="dialog"
      aria-modal="true"
      aria-label="Reading list"
      className="fixed right-0 top-0 z-40 flex h-full w-full max-w-md flex-col p-6 shadow-2xl transition-transform"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderLeft: "1px solid var(--border-default)",
      }}
    >
      <div className="mb-4 flex items-center justify-between border-b pb-4" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-xl">📚</span>
          <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
            Saved Papers ({list.length})
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {list.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="rounded-lg px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-80"
              style={{
                border: "1px solid var(--border-subtle)",
                backgroundColor: "var(--bg-elevated)",
                color: "var(--text-secondary)",
              }}
              aria-label="Clear all saved papers"
            >
              Clear all
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-xs transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)]"
            style={{ color: "var(--text-secondary)" }}
            aria-label="Close reading list"
          >
            ✕
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <span className="text-3xl mb-2" aria-hidden="true">📖</span>
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
            No saved papers yet.
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Click &ldquo;Save&rdquo; on any search result to build your reading list.
          </p>
        </div>
      ) : (
        <ul className="flex-1 space-y-3 overflow-y-auto pr-1" aria-label="Saved papers list">
          {list.map((item) => (
            <li
              key={item.arxiv_id}
              className="rounded-xl p-3.5 transition-colors"
              style={{
                border: "1px solid var(--border-subtle)",
                backgroundColor: "var(--bg-page)",
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <a
                  href={item.entry_url || `https://arxiv.org/abs/${item.arxiv_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-xs hover:underline leading-snug"
                  style={{ color: "var(--text-primary)" }}
                >
                  {item.title}
                </a>
                <button
                  type="button"
                  onClick={() => onRemove(item.arxiv_id)}
                  className="shrink-0 text-xs transition-colors hover:opacity-80 p-0.5"
                  style={{ color: "var(--text-muted)" }}
                  aria-label={`Remove ${item.title} from reading list`}
                >
                  ✕
                </button>
              </div>
              <p className="mt-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                {item.authors.slice(0, 2).join(", ")}
                {item.authors.length > 2 && " et al."}
              </p>
              <div className="mt-2.5 flex items-center justify-between text-[11px]">
                <a
                  href={item.entry_url || `https://arxiv.org/abs/${item.arxiv_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[10px] hover:underline"
                  style={{ color: "var(--text-accent-dim)" }}
                >
                  arXiv:{item.arxiv_id}
                </a>
                <div className="flex gap-2">
                  <a
                    href={item.pdf_url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium hover:underline"
                    style={{ color: "var(--text-accent)" }}
                  >
                    PDF ↗
                  </a>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 border-t pt-3 text-[11px] text-center" style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}>
        Saved locally in this browser.
      </p>
    </aside>
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
            } catch {}
            boundaryIndex = buffer.indexOf("\n\n");
            continue;
          }

          if (eventType === "validation") {
            try {
              const parsed = JSON.parse(data) as SynthesisValidation;
              setSynthesisValidation(parsed);
            } catch {}
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
    const targetIds = Array.isArray(idsToCompare)
      ? idsToCompare
      : selectedForCompare.length >= 2
      ? selectedForCompare
      : results.slice(0, 3).map((p) => p.arxiv_id);

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
        } catch {}
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

          {/* ── Top Header / Brand Bar ───────────────────────────────────── */}
          <header
            className="mb-10 flex flex-wrap items-center justify-between gap-3 rounded-[18px] p-4 shadow-sm"
            style={{
              border: "1px solid var(--border-default)",
              backgroundColor: "var(--bg-surface)",
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl"
                style={{
                  backgroundColor: "var(--cyan-subtle)",
                  border: "1px solid rgba(6,182,212,0.3)",
                }}
                aria-hidden="true"
              >
                <span style={{ color: "var(--text-accent)", fontSize: "1.2rem" }}>⬡</span>
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
                className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
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
                    className="rounded-full px-1.5 py-0.2 text-xs font-bold"
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
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
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

          {/* ── Hero + Search Field ──────────────────────────────────────── */}
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

            {/* Example suggested queries */}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                Try:
              </span>
              {EXAMPLE_QUERIES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => handleExampleClick(example)}
                  className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)]"
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
                <div className="relative flex-1">
                  <div
                    className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4"
                    aria-hidden="true"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                  </div>
                  <input
                    id="search-input"
                    value={queryInput}
                    onChange={(event) => setQueryInput(event.target.value)}
                    placeholder="Search arXiv topics, methods, or questions…"
                    maxLength={400}
                    autoComplete="off"
                    className="h-12 w-full rounded-xl pl-11 pr-10 text-base transition-all"
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
                  {queryInput.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setQueryInput("")}
                      className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-xs transition-colors hover:opacity-80"
                      style={{ color: "var(--text-muted)" }}
                      aria-label="Clear search input"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="h-12 rounded-xl px-7 text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
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

          {/* ── Filters Section ──────────────────────────────────────────── */}
          <section
            className="mx-auto mt-6 w-full max-w-5xl rounded-[18px] p-5 transition-all shadow-sm"
            style={{
              border:
                activeFilterCount > 0
                  ? "1px solid rgba(6,182,212,0.35)"
                  : "1px solid var(--border-subtle)",
              backgroundColor: "var(--bg-surface)",
            }}
            aria-label="Search filters"
          >
            <div className="mb-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <p
                  className="text-xs font-bold uppercase tracking-widest"
                  style={{ color: "var(--text-accent-dim)" }}
                >
                  Filters
                </p>
                {activeFilterCount > 0 ? (
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={{
                      backgroundColor: "var(--cyan-subtle)",
                      color: "var(--text-accent)",
                      border: "1px solid rgba(6,182,212,0.3)",
                    }}
                    aria-label={`${activeFilterCount} active filters`}
                  >
                    {activeFilterCount} active
                  </span>
                ) : (
                  <span
                    className="text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Default: All categories · 2015+
                  </span>
                )}
              </div>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-xs font-medium transition-colors hover:underline focus-visible:outline-none"
                  style={{ color: "var(--text-accent)" }}
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
                  <span>
                    From:{" "}
                    <strong style={{ color: "var(--text-primary)" }}>
                      {yearFrom} or later
                    </strong>
                  </span>
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
                <div
                  className="flex flex-wrap gap-1.5"
                  role="group"
                  aria-label="Research category filters"
                >
                  {AVAILABLE_CATEGORIES.map((category) => {
                    const active = selectedCategories.includes(category);
                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() => toggleCategory(category)}
                        className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)]"
                        style={{
                          border: active
                            ? "1px solid rgba(6,182,212,0.5)"
                            : "1px solid var(--border-subtle)",
                          backgroundColor: active
                            ? "var(--cyan-subtle)"
                            : "var(--bg-elevated)",
                          color: active
                            ? "var(--text-accent)"
                            : "var(--text-secondary)",
                        }}
                        aria-pressed={active}
                        aria-label={`${active ? "Remove" : "Add"} ${category} filter`}
                      >
                        {active && <span className="mr-1">✓</span>}
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

          {/* ── Results Section ──────────────────────────────────────────── */}
          <section
            className="mx-auto mt-8 w-full max-w-6xl"
            aria-label="Search results"
            aria-live="polite"
          >
            {/* Ranking degraded note */}
            {rankingNote && !isLoading && (
              <div
                className="mb-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm"
                style={{
                  border: "1px solid rgba(245,158,11,0.3)",
                  backgroundColor: "rgba(245,158,11,0.07)",
                  color: "#fbbf24",
                }}
                role="alert"
              >
                <span>⚠</span>
                <span>{rankingNote}</span>
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
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      border: "1px solid var(--border-subtle)",
                    }}
                    aria-hidden="true"
                  >
                    🔭
                  </div>
                  <p
                    className="text-xl font-semibold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    Search for any research topic
                  </p>
                  <p
                    className="mt-2 text-sm"
                    style={{ color: "var(--text-secondary)" }}
                  >
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
                <p className="mb-4 text-sm font-medium" style={{ color: "#fda4af" }}>
                  {errorMessage}
                </p>
                <button
                  type="button"
                  onClick={() => runSearch(activeQuery || queryInput)}
                  className="rounded-lg px-5 py-2 text-sm font-semibold transition-colors hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
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
                <p
                  className="text-lg font-medium"
                  style={{ color: "var(--text-primary)" }}
                >
                  No papers found
                </p>
                <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                  Try broadening your query, reducing the year filter, or removing
                  category filters.
                </p>
              </div>
            )}

            {/* Results list */}
            {!isLoading && !errorMessage && results.length > 0 && (
              <div className="space-y-6">
                {/* Synthesis Panel */}
                <SynthesisPanel
                  activeQuery={activeQuery}
                  isSynthesizing={isSynthesizing}
                  isSynthesisComplete={isSynthesisComplete}
                  synthesisText={synthesisText}
                  synthesisError={synthesisError}
                  synthesisSources={synthesisSources}
                  synthesisValidation={synthesisValidation}
                  copyLabel={copyLabel}
                  selectedCompareCount={selectedForCompare.length}
                  isComparing={isComparing}
                  resultsLength={results.length}
                  onGenerateSynthesis={generateSynthesis}
                  onCancelSynthesis={cancelSynthesis}
                  onGenerateComparison={generateComparison}
                  onCopySynthesis={copySynthesis}
                />

                {/* Structured Paper Comparison Section */}
                {showComparisonView && (
                  <ComparisonMatrix
                    isComparing={isComparing}
                    comparisonError={comparisonError}
                    comparisonResult={comparisonResult}
                    onClose={() => setShowComparisonView(false)}
                    onRetry={() => generateComparison()}
                  />
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
                    papers · ranked by semantic similarity to search query
                  </p>
                  {selectedGraphCount > 0 && (
                    <Link
                      href={graphHref}
                      className="rounded-full px-3 py-1 text-xs font-semibold transition-colors hover:opacity-85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)]"
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

                {/* Paper cards grid */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {results.map((paper) => (
                    <PaperCard
                      key={paper.arxiv_id}
                      paper={paper}
                      inGraph={normalizedSelectedForGraph.includes(paper.arxiv_id)}
                      isSaved={savedIds.has(paper.arxiv_id)}
                      inCompare={selectedForCompare.includes(paper.arxiv_id)}
                      abstractExpanded={!!expandedAbstracts[paper.arxiv_id]}
                      summaryState={summaryById[paper.arxiv_id]}
                      onToggleAbstract={toggleAbstract}
                      onToggleGraph={toggleGraphSelection}
                      onToggleCompare={toggleComparePaper}
                      onToggleSaved={toggleSavedPaper}
                      onSummarize={summarizePaper}
                    />
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
