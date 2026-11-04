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
  model?: string;
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
  "LLM",
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

function SkeletonRankedList() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-label="Loading search results"
    >
      {Array.from({ length: 4 }).map((_, idx) => (
        <div
          key={idx}
          className="flex items-start gap-4 pb-6 border-b border-[#294058]/50"
        >
          <div className="h-6 w-8 rounded bg-[#14263a] animate-pulse shrink-0" />
          <div className="flex-1 space-y-3">
            <div className="h-6 w-3/4 rounded bg-[#14263a] animate-pulse" />
            <div className="h-4 w-1/3 rounded bg-[#14263a] animate-pulse" />
            <div className="flex gap-2">
              <div className="h-5 w-16 rounded bg-[#14263a] animate-pulse" />
              <div className="h-5 w-16 rounded bg-[#14263a] animate-pulse" />
            </div>
            <div className="space-y-1.5 pt-1">
              <div className="h-3.5 w-full rounded bg-[#14263a] animate-pulse" />
              <div className="h-3.5 w-5/6 rounded bg-[#14263a] animate-pulse" />
            </div>
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
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-[#294058] bg-[#101e30] p-6 shadow-2xl"
      role="dialog"
      aria-label="Saved papers reading list"
    >
      <div className="flex items-center justify-between border-b border-[#294058] pb-4">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-[#24c6d8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
          <h2 className="text-base font-bold text-[#eaf2f8]">
            Reading List ({list.length})
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-xs text-[#a7bacd] hover:text-[#eaf2f8]"
          aria-label="Close reading list"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-4 space-y-3">
        {list.length === 0 ? (
          <p className="text-xs text-[#a7bacd]">
            No saved papers yet. Click &ldquo;Save&rdquo; on any paper to add it here.
          </p>
        ) : (
          list.map((entry) => (
            <div
              key={entry.arxiv_id}
              className="rounded-lg border border-[#294058] bg-[#14263a] p-3 text-xs flex flex-col gap-2"
            >
              <div className="flex items-start justify-between gap-2">
                <a
                  href={entry.entry_url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-[#eaf2f8] hover:text-[#24c6d8] hover:underline leading-snug line-clamp-2"
                >
                  {entry.title}
                </a>
                <button
                  type="button"
                  onClick={() => onRemove(entry.arxiv_id)}
                  className="text-[#a7bacd] hover:text-rose-400 p-0.5"
                  aria-label={`Remove ${entry.title} from reading list`}
                >
                  ✕
                </button>
              </div>
              <div className="flex items-center justify-between text-[11px] text-[#a7bacd]">
                <span>{entry.authors[0] || "Unknown"}</span>
                <div className="flex items-center gap-2">
                  <a
                    href={entry.entry_url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[#24c6d8] hover:underline"
                  >
                    arXiv ↗
                  </a>
                  <a
                    href={entry.pdf_url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[#24c6d8] hover:underline"
                  >
                    PDF ↗
                  </a>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {list.length > 0 && (
        <div className="border-t border-[#294058] pt-3 flex justify-end">
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-rose-300 hover:underline"
          >
            Clear reading list
          </button>
        </div>
      )}
    </aside>
  );
}

// ─── Main Discover Component ──────────────────────────────────────────────────

export default function Home() {
  const [queryInput, setQueryInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [yearFrom, setYearFrom] = useState<number>(MIN_YEAR);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [maxResults, setMaxResults] = useState<number>(10);
  const [expandedFilterDrawer, setExpandedFilterDrawer] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [results, setResults] = useState<PaperResult[]>([]);
  const [rankingNote, setRankingNote] = useState<string | null>(null);

  // Expanded abstracts & local summaries
  const [expandedAbstracts, setExpandedAbstracts] = useState<Record<string, boolean>>({});
  const [summaryById, setSummaryById] = useState<Record<string, SummaryState>>({});

  // Graph selections
  const [selectedForGraph, setSelectedForGraph] = useState<string[]>([]);

  // Compare selection
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [showComparisonView, setShowComparisonView] = useState(false);

  // Synthesis state
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isSynthesisComplete, setIsSynthesisComplete] = useState(false);
  const [synthesisText, setSynthesisText] = useState("");
  const [synthesisError, setSynthesisError] = useState<string | null>(null);
  const [synthesisSources, setSynthesisSources] = useState<SynthesisSource[]>([]);
  const [synthesisValidation, setSynthesisValidation] = useState<SynthesisValidation | null>(null);
  const [copyLabel, setCopyLabel] = useState("Copy");

  // Reading list state
  const [readingList, setReadingList] = useState<ReadingListEntry[]>([]);
  const [showReadingList, setShowReadingList] = useState(false);

  // Refs for tracking search and stream cancellation
  const searchRequestIdRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const synthesisAbortRef = useRef<AbortController | null>(null);
  const synthesisReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const searchCacheRef = useRef<Map<string, SearchResponse>>(new Map());

  // ── Initialization from LocalStorage ───────────────────────────────────────

  useEffect(() => {
    try {
      const storedGraph = window.localStorage.getItem(GRAPH_SELECTION_STORAGE_KEY);
      if (storedGraph) {
        const parsed = JSON.parse(storedGraph);
        if (Array.isArray(parsed)) setSelectedForGraph(parsed);
      }
    } catch {}

    setReadingList(loadReadingList());
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        GRAPH_SELECTION_STORAGE_KEY,
        JSON.stringify(selectedForGraph),
      );
    } catch {}
  }, [selectedForGraph]);

  const savedIds = useMemo(() => new Set(readingList.map((e) => e.arxiv_id)), [readingList]);
  const normalizedSelectedForGraph = useMemo(
    () => selectedForGraph.map((id) => id.trim()),
    [selectedForGraph],
  );

  const activeFilterCount =
    (yearFrom > MIN_YEAR ? 1 : 0) +
    selectedCategories.length +
    (maxResults !== 10 ? 1 : 0);

  // ── Search Execution ───────────────────────────────────────────────────────

  const buildCacheKey = useCallback(
    (q: string, y: number, cats: string[], maxR: number) => {
      const sortedCats = [...cats].sort().join(",");
      return `${q.trim().toLowerCase()}__${y}__${sortedCats}__${maxR}`;
    },
    [],
  );

  const cancelActiveSynthesis = useCallback(() => {
    if (synthesisReaderRef.current) {
      synthesisReaderRef.current.cancel().catch(() => {});
      synthesisReaderRef.current = null;
    }
    if (synthesisAbortRef.current) {
      synthesisAbortRef.current.abort();
      synthesisAbortRef.current = null;
    }
    setIsSynthesizing(false);
    setSynthesisText("");
    setSynthesisError(null);
    setSynthesisSources([]);
    setSynthesisValidation(null);
    setIsSynthesisComplete(false);
  }, []);

  const runSearch = useCallback(
    async (
      searchQuery: string,
      year = yearFrom,
      cats = selectedCategories,
      maxR = maxResults,
    ) => {
      const trimmed = searchQuery.trim();
      if (!trimmed) return;

      cancelActiveSynthesis();
      setShowComparisonView(false);

      const cacheKey = buildCacheKey(trimmed, year, cats, maxR);
      const cached = searchCacheRef.current.get(cacheKey);

      if (cached) {
        if (searchAbortRef.current) {
          searchAbortRef.current.abort();
          searchAbortRef.current = null;
        }
        searchRequestIdRef.current += 1;
        setIsLoading(false);
        setHasSearched(true);
        setActiveQuery(trimmed);
        setErrorMessage(null);
        setResults(cached.results);
        setRankingNote(cached.ranking_note || null);
        return;
      }

      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
      }
      const controller = new AbortController();
      searchAbortRef.current = controller;

      const currentReqId = ++searchRequestIdRef.current;

      setIsLoading(true);
      setHasSearched(true);
      setActiveQuery(trimmed);
      setErrorMessage(null);

      try {
        const response = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: trimmed,
            max_results: maxR,
            filters: {
              date_from: year > MIN_YEAR ? `${year}-01-01` : undefined,
              categories: cats.length > 0 ? cats : undefined,
            },
          }),
          signal: controller.signal,
        });

        if (controller.signal.aborted || currentReqId !== searchRequestIdRef.current) {
          return;
        }

        if (!response.ok) {
          if (response.status === 503 || response.status === 504) {
            throw new Error("arXiv is currently unavailable. Please try again shortly.");
          }
          let errorDetail = "Search request failed.";
          try {
            const errData = await response.json();
            if (errData?.detail) {
              errorDetail =
                typeof errData.detail === "string"
                  ? errData.detail
                  : JSON.stringify(errData.detail);
            }
          } catch {}
          throw new Error(errorDetail);
        }

        const data = (await response.json()) as SearchResponse;

        if (currentReqId !== searchRequestIdRef.current) return;

        searchCacheRef.current.set(cacheKey, data);
        setResults(data.results);
        setRankingNote(data.ranking_note || null);
      } catch (error) {
        if (controller.signal.aborted || currentReqId !== searchRequestIdRef.current) {
          return;
        }
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to search arXiv papers.",
        );
        setResults([]);
      } finally {
        if (currentReqId === searchRequestIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    [yearFrom, selectedCategories, maxResults, buildCacheKey, cancelActiveSynthesis],
  );

  function handleSearchSubmit(event: FormEvent) {
    event.preventDefault();
    runSearch(queryInput);
  }

  function handleExampleClick(example: string) {
    setQueryInput(example);
    runSearch(example);
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
    setExpandedFilterDrawer(null);
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

  function toggleComparePaper(arxivId: string) {
    setSelectedForCompare((current) => {
      if (current.includes(arxivId)) {
        return current.filter((id) => id !== arxivId);
      }
      if (current.length >= 4) return current;
      return [...current, arxivId];
    });
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
            msg =
              typeof errData.detail === "string"
                ? errData.detail
                : JSON.stringify(errData.detail);
          }
        } catch {}
        throw new Error(msg);
      }

      const data = (await response.json()) as { arxiv_id: string; summary: string; model?: string };
      setSummaryById((current) => ({
        ...current,
        [arxivId]: {
          loading: false,
          open: true,
          summary: data.summary,
          model: data.model,
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
          error: error instanceof Error ? error.message : "Summary unavailable.",
        },
      }));
    }
  }

  // ── Topic Synthesis Stream ─────────────────────────────────────────────────

  async function generateSynthesis() {
    if (results.length === 0 || isSynthesizing) return;

    if (synthesisAbortRef.current) {
      synthesisAbortRef.current.abort();
    }
    const controller = new AbortController();
    synthesisAbortRef.current = controller;

    setIsSynthesizing(true);
    setIsSynthesisComplete(false);
    setSynthesisText("");
    setSynthesisError(null);
    setSynthesisSources([]);
    setSynthesisValidation(null);

    const papersPayload = results.slice(0, 5).map((p) => ({
      arxiv_id: p.arxiv_id,
      title: p.title,
      authors: p.authors,
      abstract: p.abstract,
      published: p.published,
      categories: p.categories,
      entry_url: p.entry_url,
      pdf_url: p.pdf_url,
    }));

    try {
      const response = await fetch("/api/search/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: activeQuery,
          papers: papersPayload,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let msg = "Synthesis unavailable right now.";
        try {
          const errData = await response.json();
          if (errData?.detail) {
            msg =
              typeof errData.detail === "string"
                ? errData.detail
                : JSON.stringify(errData.detail);
          }
        } catch {}
        throw new Error(msg);
      }

      if (!response.body) {
        throw new Error("Readable stream not supported by server.");
      }

      const reader = response.body.getReader();
      synthesisReaderRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const eventBlock of events) {
          if (!eventBlock.trim()) continue;

          let eventType = "message";
          let dataStr = "";

          const lines = eventBlock.split("\n");
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventType = line.replace("event:", "").trim();
            } else if (line.startsWith("data:")) {
              const piece = line.slice(5);
              dataStr += (dataStr ? "\n" : "") + (piece.startsWith(" ") ? piece.slice(1) : piece);
            }
          }

          if (eventType === "sources") {
            try {
              const parsed = JSON.parse(dataStr);
              if (Array.isArray(parsed)) setSynthesisSources(parsed);
            } catch {}
          } else if (eventType === "validation") {
            try {
              const parsed = JSON.parse(dataStr);
              setSynthesisValidation(parsed);
            } catch {}
          } else if (eventType === "error") {
            setSynthesisError(dataStr || "Error during synthesis generation.");
          } else {
            setSynthesisText((current) => current + dataStr);
          }
        }
      }

      setIsSynthesisComplete(true);
    } catch (error) {
      if (controller.signal.aborted) return;
      setSynthesisError(
        error instanceof Error ? error.message : "Failed to generate synthesis.",
      );
    } finally {
      if (synthesisAbortRef.current === controller) {
        setIsSynthesizing(false);
      }
    }
  }

  function cancelSynthesis() {
    cancelActiveSynthesis();
  }

  function copySynthesis() {
    if (!synthesisText) return;
    try {
      navigator.clipboard.writeText(synthesisText);
      setCopyLabel("Copied!");
      setTimeout(() => setCopyLabel("Copy"), 2000);
    } catch {}
  }

  // ── Compare Action ─────────────────────────────────────────────────────────

  async function generateComparison() {
    const targetIds =
      selectedForCompare.length >= 2
        ? selectedForCompare
        : results.slice(0, 3).map((r) => r.arxiv_id);

    if (targetIds.length < 2) {
      setComparisonError("Select at least 2 papers to compare.");
      setShowComparisonView(true);
      return;
    }

    const clientPapers = targetIds.slice(0, 4).map((id) => {
      const p = results.find((r) => r.arxiv_id === id);
      return {
        arxiv_id: id,
        title: p?.title || id,
        authors: p?.authors || [],
        abstract: p?.abstract || "",
        published: p?.published || "",
        categories: p?.categories || [],
        pdf_url: p?.pdf_url || `https://arxiv.org/pdf/${id}`,
        entry_url: p?.entry_url || `https://arxiv.org/abs/${id}`,
      };
    });

    setIsComparing(true);
    setComparisonError(null);
    setShowComparisonView(true);

    try {
      const response = await fetch("/api/papers/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          arxiv_ids: targetIds.slice(0, 4),
          papers: clientPapers,
        }),
      });

      if (!response.ok) {
        let msg = "Comparison matrix unavailable.";
        try {
          const errData = await response.json();
          if (errData?.detail) msg = String(errData.detail);
        } catch {}
        throw new Error(msg);
      }

      const data = (await response.json()) as ComparisonResult;
      setComparisonResult(data);
    } catch (error) {
      setComparisonError(
        error instanceof Error ? error.message : "Failed to compare papers.",
      );
    } finally {
      setIsComparing(false);
    }
  }

  // ── Derived State ──────────────────────────────────────────────────────────

  const showEmptyPrompt = !hasSearched && !isLoading && !errorMessage;
  const showNoResults =
    !isLoading && !errorMessage && hasSearched && results.length === 0;

  return (
    <div className="min-h-screen bg-[#07111d] text-[#eaf2f8]">
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
            className="fixed inset-0 z-40 bg-[#07111d]/80 backdrop-blur-sm"
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

      {/* Main Workspace Container */}
      <main className="page-container py-6 sm:py-8 flex flex-col gap-6">
        {/* Top Compact Section: Heading & Search & Filters */}
        <div className="flex flex-col gap-4">
          {/* 1. Heading and one-line description */}
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#eaf2f8]">
              Explore research with clarity
              {/* Screen reader compatibility text */}
              <span className="sr-only">Discover Research</span>
            </h1>
            <p className="mt-1 text-sm text-[#a7bacd]">
              Search arXiv papers and examine the evidence behind each synthesis.
              <span className="sr-only">Search for any research topic across arXiv papers with vector semantic retrieval, neural synthesis, and relationship mapping.</span>
            </p>
          </div>

          {/* 2. Wide Search Form */}
          <form
            onSubmit={handleSearchSubmit}
            role="search"
            className="w-full"
          >
            <label htmlFor="search-input" className="sr-only">
              Search arXiv research papers
            </label>

            <div className="relative flex items-center rounded-xl border border-[#294058] bg-[#101e30] p-1.5 transition-colors focus-within:border-[#24c6d8] focus-within:ring-2 focus-within:ring-[#24c6d8]/20">
              <div
                className="pointer-events-none flex items-center pl-3 pr-2 text-[#a7bacd]"
                aria-hidden="true"
              >
                <svg
                  className="h-4 w-4"
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
                placeholder="Search arXiv topics, methods, or research questions…"
                maxLength={400}
                autoComplete="off"
                className="h-10 w-full bg-transparent px-2 text-sm text-[#eaf2f8] placeholder-[#738a9f] focus:outline-none"
              />

              {queryInput.length > 0 && (
                <button
                  type="button"
                  onClick={() => setQueryInput("")}
                  className="mr-2 rounded p-1 text-xs text-[#a7bacd] transition-colors hover:text-[#eaf2f8]"
                  aria-label="Clear search input"
                >
                  ✕
                </button>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-[#24c6d8] px-5 sm:px-7 text-sm font-bold text-[#07111d] transition-colors hover:bg-[#3de0f2] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#24c6d8] shrink-0"
              >
                {isLoading ? (
                  <>
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#07111d] border-t-transparent" />
                    <span>Searching…</span>
                  </>
                ) : (
                  <span>Search</span>
                )}
              </button>
            </div>
          </form>

          {/* Suggested Queries */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#a7bacd]">
            <span className="font-mono text-xs font-semibold text-[#738a9f] mr-1">
              Try:
            </span>
            {EXAMPLE_QUERIES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => handleExampleClick(example)}
                className="inline-flex items-center rounded-md border border-[#294058] bg-[#14263a] px-2.5 py-1 text-xs text-[#a7bacd] transition-colors hover:border-[#24c6d8]/40 hover:text-[#24c6d8]"
                aria-label={`Fill search with: ${example}`}
              >
                {example}
              </button>
            ))}
          </div>

          {/* 3. Slim Filter Row (Image 1 & Image 3 Specification) */}
          <div
            className="flex flex-col gap-2 pt-1 border-t border-[#294058]/50"
            aria-label="Search filters"
          >
            {/* Filter Pills Header Row */}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                {/* Year Filter Pill */}
                <button
                  type="button"
                  onClick={() =>
                    setExpandedFilterDrawer(
                      expandedFilterDrawer === "year" ? null : "year",
                    )
                  }
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    yearFrom > MIN_YEAR || expandedFilterDrawer === "year"
                      ? "border-[#24c6d8] bg-[#14263a] text-[#24c6d8]"
                      : "border-[#294058] bg-[#101e30] text-[#a7bacd] hover:border-[#3d5a7a] hover:text-[#eaf2f8]"
                  }`}
                  aria-expanded={expandedFilterDrawer === "year"}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  <span>Since {yearFrom > MIN_YEAR ? yearFrom : 2020}</span>
                  <span className="text-[10px]">⌵</span>
                </button>

                {/* Categories Filter Pill */}
                <button
                  type="button"
                  onClick={() =>
                    setExpandedFilterDrawer(
                      expandedFilterDrawer === "categories" ? null : "categories",
                    )
                  }
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    selectedCategories.length > 0 || expandedFilterDrawer === "categories"
                      ? "border-[#24c6d8] bg-[#14263a] text-[#24c6d8]"
                      : "border-[#294058] bg-[#101e30] text-[#a7bacd] hover:border-[#3d5a7a] hover:text-[#eaf2f8]"
                  }`}
                  aria-expanded={expandedFilterDrawer === "categories"}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  <span>
                    Categories
                    {selectedCategories.length > 0
                      ? `: ${selectedCategories.join(", ")}`
                      : " (all)"}
                  </span>
                  <span className="text-[10px]">⌵</span>
                </button>

                {/* Result Count Pill */}
                <div className="relative inline-flex items-center">
                  <label htmlFor="result-count" className="sr-only">
                    Result Count
                  </label>
                  <select
                    id="result-count"
                    value={maxResults}
                    onChange={(event) => setMaxResults(Number(event.target.value))}
                    className="h-8 rounded-lg border border-[#294058] bg-[#101e30] px-3 py-1 text-xs font-medium text-[#a7bacd] transition-colors hover:border-[#3d5a7a] hover:text-[#eaf2f8] focus:border-[#24c6d8] focus:outline-none cursor-pointer"
                  >
                    <option value={5}>5 papers ⌵</option>
                    <option value={10}>10 papers ⌵</option>
                    <option value={25}>25 papers ⌵</option>
                  </select>
                </div>

                {/* Reset Filters */}
                {activeFilterCount > 0 && (
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded border border-[#24c6d8]/40 bg-[#24c6d8]/10 px-2 py-0.5 font-mono text-xs font-semibold text-[#24c6d8]"
                      aria-label={`${activeFilterCount} active filters`}
                    >
                      {activeFilterCount} active
                    </span>
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#24c6d8] hover:text-[#3de0f2] hover:underline"
                    >
                      <span className="text-[#294058] mr-1">|</span>
                      <span>Reset filters</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Mobile Active Filter Summary Chip (Image 3) */}
              {activeFilterCount > 0 && (
                <div className="flex sm:hidden items-center gap-1 text-xs text-[#24c6d8]">
                  <span>✓</span>
                  <span>
                    Active: Since {yearFrom} · {selectedCategories.length || "All"} cats · {maxResults} papers
                  </span>
                </div>
              )}
            </div>

            {/* Expandable Category & Year Controls (always accessible in DOM for screen readers and tests) */}
            <div
              className={`rounded-lg border border-[#294058] bg-[#101e30] p-3 text-xs transition-all ${
                expandedFilterDrawer || activeFilterCount > 0 ? "block" : "hidden sm:block"
              }`}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                {/* Earliest Publication Year Slider */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-[#a7bacd]">
                    Earliest Publication Year
                  </span>
                  <div className="flex items-center justify-between rounded-lg border border-[#294058] bg-[#14263a] px-3 py-1.5 text-xs text-[#a7bacd]">
                    <span>
                      From:{" "}
                      <strong className="text-[#eaf2f8]">
                        {yearFrom} or later
                      </strong>
                    </span>
                    <span className="font-mono text-xs text-[#738a9f]">
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
                    className="w-full accent-[#24c6d8] cursor-pointer h-1.5 bg-[#14263a] rounded"
                    aria-valuemin={MIN_YEAR}
                    aria-valuemax={CURRENT_YEAR}
                    aria-valuenow={yearFrom}
                    aria-label={`Earliest publication year: ${yearFrom} or later`}
                  />
                </div>

                {/* arXiv Category Filter Buttons */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-[#a7bacd]">
                    Filter by Categories:
                  </span>
                  <div className="flex flex-wrap gap-1" role="group" aria-label="Research category filters">
                    {AVAILABLE_CATEGORIES.map((category) => {
                      const active = selectedCategories.includes(category);
                      return (
                        <button
                          key={category}
                          type="button"
                          onClick={() => toggleCategory(category)}
                          className={`rounded px-2 py-0.5 font-mono text-xs font-medium transition-colors ${
                            active
                              ? "border border-[#24c6d8]/50 bg-[#24c6d8]/15 text-[#24c6d8] font-semibold"
                              : "border border-[#294058] bg-[#14263a] text-[#a7bacd] hover:border-[#3d5a7a] hover:text-[#eaf2f8]"
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
              </div>
            </div>
          </div>
        </div>

        {/* ── Working Workspace: Results Left (2/3) + Rail Right (1/3) ── */}
        <div className="w-full">
          {/* Targeted Screen Reader Live Status Region */}
          <div className="sr-only" role="status" aria-live="polite">
            {isLoading
              ? "Searching arXiv research papers…"
              : hasSearched
              ? `Found ${results.length} papers for ${activeQuery}`
              : ""}
          </div>

          {/* Ranking Degraded Alert */}
          {rankingNote && !isLoading && (
            <div
              className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300"
              role="alert"
            >
              <span>⚠</span>
              <span>{rankingNote}</span>
            </div>
          )}

          {/* Comparison Matrix Modal/View */}
          {showComparisonView && (
            <div className="mb-6">
              <ComparisonMatrix
                isComparing={isComparing}
                comparisonError={comparisonError}
                comparisonResult={comparisonResult}
                onClose={() => setShowComparisonView(false)}
                onRetry={() => generateComparison()}
              />
            </div>
          )}

          {/* Initial Clean Empty Prompt */}
          {showEmptyPrompt && (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#294058] bg-[#101e30]/40 py-16 px-6 text-center">
              <div
                className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-[#294058] bg-[#14263a] text-2xl"
                aria-hidden="true"
              >
                🔭
              </div>
              <p className="text-base font-semibold text-[#eaf2f8]">
                Search for any research topic
              </p>
              <p className="mt-1 text-xs text-[#a7bacd] max-w-sm">
                Try one of the example queries above or enter your own keywords, methodology, or arXiv research question.
              </p>
            </div>
          )}

          {/* Loading Skeletons */}
          {isLoading && <SkeletonRankedList />}

          {/* Error State with Retry */}
          {!isLoading && errorMessage && (
            <div
              className="mx-auto max-w-xl rounded-xl border border-rose-500/40 bg-rose-500/10 p-5 text-center my-6"
              role="alert"
            >
              <p className="mb-3 text-sm font-medium text-rose-300">
                {errorMessage}
              </p>
              <button
                type="button"
                onClick={() => runSearch(activeQuery || queryInput)}
                className="rounded-lg bg-rose-700 hover:bg-rose-600 px-4 py-1.5 text-xs font-bold text-white transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {/* No Results */}
          {showNoResults && (
            <div
              className="mx-auto max-w-xl rounded-xl border border-[#294058] bg-[#101e30] p-8 text-center my-6"
              role="status"
            >
              <p className="text-base font-bold text-[#eaf2f8]">
                No papers found
              </p>
              <p className="mt-1.5 text-xs text-[#a7bacd]">
                Try broadening your query, reducing the year filter, or removing category filters.
              </p>
            </div>
          )}

          {/* Results: Two-Column Workspace (Desktop) / Stacked (Mobile) */}
          {!isLoading && !errorMessage && results.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left Column: Ranked Paper List (~2/3 width) */}
              <section
                className="lg:col-span-8 flex flex-col gap-6"
                aria-label="Search results list"
              >
                {/* Results Header */}
                <div className="flex flex-col gap-1 pb-3 border-b border-[#294058]">
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#eaf2f8]">
                    Results for {activeQuery}
                  </h2>
                  <p className="text-xs sm:text-sm text-[#a7bacd]">
                    {results.length} papers · Sorted by relevance to &ldquo;{activeQuery}&rdquo;
                  </p>
                </div>

                {/* Vertical Ranked Result List (Image 1 Specification) */}
                <div className="flex flex-col gap-6">
                  {results.map((paper, idx) => (
                    <PaperCard
                      key={paper.arxiv_id}
                      rankIndex={idx + 1}
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
              </section>

              {/* Right Column: Sticky Rail (~1/3 width) with Synthesis & Compare */}
              <aside
                className="lg:col-span-4 flex flex-col gap-5 lg:sticky lg:top-20"
                aria-label="Research context and tools"
              >
                {/* Card 1: Research synthesis */}
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

                {/* Card 2: Compare papers */}
                <div
                  className="rounded-xl border border-[#294058] bg-[#101e30] p-5 shadow-sm flex flex-col gap-3"
                  aria-label="Paper comparison selector"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold text-[#eaf2f8]">
                      Compare papers{" "}
                      <span className="text-xs font-mono font-normal text-[#a7bacd]">
                        {selectedForCompare.length}/4
                      </span>
                    </h3>
                    {selectedForCompare.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedForCompare([])}
                        className="text-xs text-[#a7bacd] hover:text-[#eaf2f8]"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {selectedForCompare.length === 0 ? (
                    <p className="text-xs text-[#a7bacd] leading-relaxed">
                      Select 2 to 4 papers using the &ldquo;Compare&rdquo; button on any paper to analyze methodology and findings side-by-side.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {selectedForCompare.map((id) => {
                        const p = results.find((r) => r.arxiv_id === id);
                        return (
                          <div
                            key={id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-[#294058] bg-[#14263a] px-3 py-2 text-xs"
                          >
                            <span className="font-medium text-[#eaf2f8] line-clamp-1 flex-1">
                              {p?.title || id}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleComparePaper(id)}
                              className="text-[#a7bacd] hover:text-[#eaf2f8] p-0.5"
                              aria-label={`Remove ${p?.title || id} from compare`}
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => generateComparison()}
                    disabled={isComparing || selectedForCompare.length < 2}
                    aria-label="Compare selected papers"
                    className="w-full mt-1 rounded-lg bg-[#24c6d8] py-2 text-xs font-bold text-[#07111d] transition-colors hover:bg-[#3de0f2] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#24c6d8]"
                  >
                    {isComparing
                      ? "Generating comparison…"
                      : selectedForCompare.length >= 2
                      ? `Compare (${selectedForCompare.length})`
                      : "Compare"}
                  </button>
                </div>
              </aside>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
