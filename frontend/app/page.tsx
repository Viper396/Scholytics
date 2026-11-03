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
import Nav from "../components/Nav";
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
      className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
      role="status"
      aria-label="Loading search results"
    >
      {Array.from({ length: 6 }).map((_, idx) => (
        <div
          key={idx}
          className="relative overflow-hidden rounded-2xl border border-[#1e385c] bg-[#0c1a2e] p-6 shadow-md"
        >
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-cyan-500/5 to-transparent" />
          <div className="mb-4 flex items-center justify-between">
            <div className="h-5 w-24 rounded-md bg-[#11223b]" />
            <div className="h-5 w-20 rounded-md bg-[#11223b]" />
          </div>
          <div className="mb-3 h-6 w-5/6 rounded-lg bg-[#11223b]" />
          <div className="mb-4 h-4 w-1/2 rounded bg-[#11223b]" />
          <div className="mb-4 h-8 w-full rounded-xl bg-[#081526]" />
          <div className="space-y-2">
            <div className="h-3.5 w-full rounded bg-[#11223b]" />
            <div className="h-3.5 w-5/6 rounded bg-[#11223b]" />
            <div className="h-3.5 w-3/4 rounded bg-[#11223b]" />
          </div>
          <div className="mt-5 flex items-center gap-2 pt-4 border-t border-[#1e385c]/60">
            <div className="h-7 w-20 rounded-lg bg-[#11223b]" />
            <div className="h-7 w-20 rounded-lg bg-[#11223b]" />
            <div className="h-7 w-16 rounded-lg bg-[#11223b]" />
          </div>
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
      className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-[#1e385c] bg-[#0c1a2e]/95 p-6 shadow-2xl backdrop-blur-xl transition-all"
    >
      <div className="mb-5 flex items-center justify-between border-b border-[#1e385c] pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
            <span aria-hidden="true">★</span>
          </div>
          <div>
            <h2 className="text-base font-bold text-[#eaf2ff]">
              Saved Papers ({list.length})
            </h2>
            <p className="text-[11px] text-[#5e779a]">Local browser reading list</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {list.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="rounded-lg border border-[#1e385c] bg-[#11223b] px-2.5 py-1 text-xs font-medium text-[#9cb1ce] transition-colors hover:border-rose-500/40 hover:text-rose-300"
              aria-label="Clear all saved papers"
            >
              Clear all
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#1e385c] bg-[#11223b] p-1.5 text-xs text-[#9cb1ce] transition-colors hover:text-[#eaf2ff] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
            aria-label="Close reading list"
          >
            ✕
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center p-6">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#1e385c] bg-[#11223b] text-2xl text-amber-400">
            ★
          </div>
          <p className="text-sm font-semibold text-[#eaf2ff]">
            No saved papers yet.
          </p>
          <p className="mt-1 max-w-xs text-xs text-[#5e779a]">
            Click &ldquo;Save&rdquo; on any search result to build your reading list.
          </p>
        </div>
      ) : (
        <ul className="flex-1 space-y-3 overflow-y-auto pr-1" aria-label="Saved papers list">
          {list.map((item) => (
            <li
              key={item.arxiv_id}
              className="rounded-xl border border-[#1e385c] bg-[#081526] p-4 transition-all hover:border-cyan-500/30"
            >
              <div className="flex items-start justify-between gap-2.5">
                <a
                  href={item.entry_url || `https://arxiv.org/abs/${item.arxiv_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-xs text-[#eaf2ff] hover:text-cyan-300 hover:underline leading-snug"
                >
                  {item.title}
                </a>
                <button
                  type="button"
                  onClick={() => onRemove(item.arxiv_id)}
                  className="shrink-0 p-1 text-xs text-[#5e779a] transition-colors hover:text-rose-400"
                  aria-label={`Remove ${item.title} from reading list`}
                >
                  ✕
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-[#9cb1ce]">
                {item.authors.slice(0, 2).join(", ")}
                {item.authors.length > 2 && " et al."}
              </p>
              <div className="mt-3 flex items-center justify-between border-t border-[#1e385c]/60 pt-2 text-[11px]">
                <a
                  href={item.entry_url || `https://arxiv.org/abs/${item.arxiv_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[10px] text-cyan-400 hover:underline"
                >
                  arXiv:{item.arxiv_id}
                </a>
                <div className="flex items-center gap-2">
                  <a
                    href={item.pdf_url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[10px] font-semibold text-cyan-300 hover:underline"
                  >
                    PDF ↗
                  </a>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 border-t border-[#1e385c] pt-3 text-center text-[11px] text-[#5e779a]">
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
    <div className="min-h-screen bg-[#051424] text-[#eaf2ff]">
      {/* Navigation Header */}
      <Nav
        selectedIds={selectedForGraph}
        savedCount={readingList.length}
        onOpenSaved={() => setShowReadingList(true)}
      />

      {/* Reading list overlay */}
      {showReadingList && (
        <>
          <div
            className="fixed inset-0 z-40 bg-[#051424]/80 backdrop-blur-sm"
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

      <main className="page-container py-8 sm:py-10 flex flex-col gap-8 sm:gap-10">
        {/* ── Hero / Omni-Search Section ──────────────────────────────── */}
        <section className="relative overflow-hidden rounded-3xl border border-[#1e385c] bg-[#0c1a2e] px-6 py-10 sm:px-12 sm:py-16 text-center shadow-2xl">
          {/* Ambient Radial Glow */}
          <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-[340px] w-[700px] rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 right-10 h-64 w-96 rounded-full bg-emerald-500/5 blur-3xl" />

          {/* Micro Badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-1 text-xs font-mono font-semibold tracking-wider text-cyan-400 uppercase shadow-sm mb-5">
            <span aria-hidden="true" className="animate-pulse">✦</span>
            <span>AI-Powered Research Discovery</span>
          </div>

          {/* Main Headline */}
          <h1 className="mx-auto max-w-4xl text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-[#eaf2ff] leading-tight">
            Discover Research <span className="text-cyan-400">Faster</span>
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-sm sm:text-base text-[#9cb1ce] leading-relaxed">
            Search live arXiv papers, generate summaries, synthesize research, and
            explore connections between ideas.
          </p>

          {/* Example suggested queries */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#5e779a]">
              Try:
            </span>
            {EXAMPLE_QUERIES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => handleExampleClick(example)}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#1e385c] bg-[#11223b] px-3.5 py-1.5 text-xs font-medium text-[#9cb1ce] transition-all hover:border-cyan-500/50 hover:bg-[#182e4e] hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                aria-label={`Fill search with: ${example}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/50" />
                <span>{example}</span>
              </button>
            ))}
          </div>

          {/* Omni-Search Bar */}
          <div className="mx-auto mt-8 w-full max-w-3xl">
            <form onSubmit={handleSearchSubmit} role="search" className="w-full">
              <label htmlFor="search-input" className="sr-only">
                Search arXiv research papers
              </label>

              <div className="relative flex items-center rounded-2xl border border-[#1e385c] bg-[#081526] p-1.5 shadow-2xl transition-all focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-400/25">
                <div
                  className="pointer-events-none flex items-center pl-3.5 pr-2 text-cyan-400"
                  aria-hidden="true"
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
                  className="h-11 w-full bg-transparent px-2 text-sm sm:text-base text-[#eaf2ff] placeholder-[#5e779a] focus:outline-none"
                />

                {queryInput.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setQueryInput("")}
                    className="mr-2 rounded-lg p-1 text-xs text-[#5e779a] transition-colors hover:text-[#eaf2ff]"
                    aria-label="Clear search input"
                  >
                    ✕
                  </button>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-500 px-5 sm:px-7 text-xs sm:text-sm font-bold text-[#04121e] shadow-[0_0_16px_rgba(34,211,238,0.25)] transition-all hover:from-cyan-300 hover:to-cyan-400 hover:shadow-[0_0_24px_rgba(34,211,238,0.4)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 shrink-0"
                >
                  {isLoading ? (
                    <>
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#04121e] border-t-transparent" />
                      <span>Searching…</span>
                    </>
                  ) : (
                    <>
                      <span>Search</span>
                      <span aria-hidden="true" className="text-sm">→</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </section>

        {/* ── Filters Section ──────────────────────────────────────────── */}
        <section
          className={`rounded-2xl border bg-[#0c1a2e] p-5 sm:p-6 shadow-md transition-all ${
            activeFilterCount > 0 ? "border-cyan-500/40" : "border-[#1e385c]"
          }`}
          aria-label="Search filters"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#1e385c]/60 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-400">
                Filters
              </span>
              {activeFilterCount > 0 ? (
                <span
                  className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 font-mono text-xs font-semibold text-cyan-400"
                  aria-label={`${activeFilterCount} active filters`}
                >
                  {activeFilterCount} active
                </span>
              ) : (
                <span className="text-xs text-[#5e779a]">
                  Default: All categories · 2015+
                </span>
              )}
            </div>

            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={resetFilters}
                className="text-xs font-medium text-cyan-400 hover:text-cyan-300 hover:underline focus-visible:outline-none"
              >
                Reset filters
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {/* Year Range Slider */}
            <div className="flex flex-col gap-2">
              <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#9cb1ce]">
                Earliest Publication Year
              </p>
              <div className="flex items-center justify-between rounded-xl border border-[#1e385c] bg-[#081526] px-3.5 py-2 text-xs text-[#9cb1ce]">
                <span>
                  From:{" "}
                  <strong className="text-[#eaf2ff]">
                    {yearFrom} or later
                  </strong>
                </span>
                <span className="font-mono text-[10px] text-[#5e779a]">
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
                className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-[#11223b] rounded-lg"
                aria-valuemin={MIN_YEAR}
                aria-valuemax={CURRENT_YEAR}
                aria-valuenow={yearFrom}
                aria-label={`Earliest publication year: ${yearFrom} or later`}
              />
            </div>

            {/* arXiv Category Chips */}
            <div className="flex flex-col gap-2">
              <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#9cb1ce]">
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
                      className={`rounded-lg px-2.5 py-1 font-mono text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
                        active
                          ? "border border-cyan-400/50 bg-cyan-500/20 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.15)]"
                          : "border border-[#1e385c] bg-[#081526] text-[#9cb1ce] hover:border-cyan-500/40 hover:text-[#eaf2ff]"
                      }`}
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

            {/* Result Density Count */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="result-count"
                className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#9cb1ce]"
              >
                Result Count
              </label>
              <select
                id="result-count"
                value={maxResults}
                onChange={(event) => setMaxResults(Number(event.target.value))}
                className="h-10 w-full rounded-xl border border-[#1e385c] bg-[#081526] px-3.5 text-xs text-[#eaf2ff] transition-all focus:border-cyan-400 focus:outline-none"
              >
                <option value={5}>5 papers</option>
                <option value={10}>10 papers</option>
                <option value={25}>25 papers</option>
              </select>
              <p className="text-xs text-[#5e779a]">
                Graph selection:{" "}
                <span className="font-mono font-bold text-cyan-400" aria-live="polite">
                  {selectedGraphCount}
                </span>
              </p>
            </div>
          </div>
        </section>

        {/* ── Results Section ──────────────────────────────────────────── */}
        <section
          className="w-full"
          aria-label="Search results"
          aria-live="polite"
        >
          {/* Ranking degraded note */}
          {rankingNote && !isLoading && (
            <div
              className="mb-6 flex items-center gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs font-medium text-amber-300"
              role="alert"
            >
              <span>⚠</span>
              <span>{rankingNote}</span>
            </div>
          )}

          {/* Initial Empty Prompt */}
          {showEmptyPrompt && (
            <div className="grid min-h-[340px] place-items-center rounded-3xl border border-dashed border-[#1e385c] bg-[#0c1a2e]/60 p-10 text-center">
              <div className="flex flex-col items-center max-w-md">
                <div
                  className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#1e385c] bg-[#11223b] text-3xl shadow-lg"
                  aria-hidden="true"
                >
                  🔭
                </div>
                <p className="text-xl font-bold tracking-tight text-[#eaf2ff]">
                  Search for any research topic
                </p>
                <p className="mt-2 text-xs sm:text-sm text-[#9cb1ce]">
                  Try one of the example queries above, or type your own question.
                </p>
              </div>
            </div>
          )}

          {/* Loading Skeletons */}
          {isLoading && <SkeletonCards />}

          {/* Error State */}
          {!isLoading && errorMessage && (
            <div
              className="mx-auto max-w-2xl rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-center"
              role="alert"
            >
              <p className="mb-4 text-sm font-semibold text-rose-300">
                {errorMessage}
              </p>
              <button
                type="button"
                onClick={() => runSearch(activeQuery || queryInput)}
                className="rounded-xl bg-rose-700 hover:bg-rose-600 px-5 py-2 text-xs font-bold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
              >
                Retry
              </button>
            </div>
          )}

          {/* No Results */}
          {showNoResults && (
            <div
              className="mx-auto max-w-2xl rounded-2xl border border-[#1e385c] bg-[#0c1a2e] p-8 text-center"
              role="status"
            >
              <p className="text-lg font-bold text-[#eaf2ff]">
                No papers found
              </p>
              <p className="mt-2 text-xs sm:text-sm text-[#9cb1ce]">
                Try broadening your query, reducing the year filter, or removing
                category filters.
              </p>
            </div>
          )}

          {/* Results List */}
          {!isLoading && !errorMessage && results.length > 0 && (
            <div className="space-y-8">
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

              {/* Result Summary Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e385c]/60 pb-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                  <p className="text-xs sm:text-sm text-[#9cb1ce]">
                    <span className="font-mono font-bold text-[#eaf2ff]">
                      {results.length}
                    </span>{" "}
                    papers · ranked by semantic similarity to search query
                  </p>
                </div>
                {selectedGraphCount > 0 && (
                  <Link
                    href={graphHref}
                    className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 font-mono text-xs font-semibold text-cyan-400 transition-all hover:bg-cyan-500/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
                  >
                    <span>Open graph ({selectedGraphCount})</span>
                    <span aria-hidden="true">→</span>
                  </Link>
                )}
              </div>

              {/* Responsive 3-Column Paper Cards Grid */}
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
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
      </main>
    </div>
  );
}
