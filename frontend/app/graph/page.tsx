"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as d3 from "d3";
import Nav from "../../components/Nav";

// ─── Types ────────────────────────────────────────────────────────────────────

type GraphNode = {
  id: string;
  title: string;
  authors: string[];
  published: string;
  categories: string[];
  relevance_score: number;
};

type GraphEdge = {
  source: string;
  target: string;
  type: "co-author" | "same-field";
  weight: number;
};

type GraphResponse = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type PaperDetails = {
  arxiv_id: string;
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  categories: string[];
  pdf_url: string;
  entry_url: string;
};

type SimNode = GraphNode & d3.SimulationNodeDatum;

type SimLink = d3.SimulationLinkDatum<SimNode> & {
  type: GraphEdge["type"];
  weight: number;
};

type TooltipState = {
  x: number;
  y: number;
  node: GraphNode;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const SVG_WIDTH = 1200;
const SVG_HEIGHT = 720;
const GRAPH_SELECTION_STORAGE_KEY = "scholytics.selectedForGraph";

// Color palette for node categories (primary category → color)
const COLOR_PALETTE = [
  "#06b6d4", // cyan
  "#38bdf8", // sky
  "#22c55e", // green
  "#f59e0b", // amber
  "#fb7185", // rose
  "#a78bfa", // violet
  "#14b8a6", // teal
  "#f97316", // orange
];

// Edge colors distinguish relationship types
const EDGE_COLORS = {
  "co-author": "#06b6d4",   // cyan — shared author between papers
  "same-field": "#334155",  // slate — shared arXiv category
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseIdsParam(value: string | null): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const rawId of value.split(",")) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function primaryCategory(node: GraphNode): string {
  return node.categories?.[0] ?? "unknown";
}

function truncateLabel(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function clampScore(score: number): number {
  if (Number.isNaN(score)) return 0;
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

// ─── Main graph content ───────────────────────────────────────────────────────

function GraphPageContent() {
  const searchParams = useSearchParams();
  const requestedIds = useMemo(
    () => parseIdsParam(searchParams.get("ids")),
    [searchParams],
  );
  const idsKey = useMemo(() => requestedIds.join(","), [requestedIds]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const [graphData, setGraphData] = useState<GraphResponse | null>(null);
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);

  const [showCoAuthorEdges, setShowCoAuthorEdges] = useState(true);
  const [showSameFieldEdges, setShowSameFieldEdges] = useState(true);

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [detailsById, setDetailsById] = useState<Record<string, PaperDetails>>({});
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  const [summaryById, setSummaryById] = useState<Record<string, string>>({});
  const [summaryLoadingById, setSummaryLoadingById] = useState<Record<string, boolean>>({});
  const [summaryErrorById, setSummaryErrorById] = useState<Record<string, string>>({});

  const [selectedForGraph, setSelectedForGraph] = useState<string[]>([]);

  // ── Hydrate from localStorage ───────────────────────────────────────────

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
  }, []);

  useEffect(() => {
    if (requestedIds.length === 0) return;
    setSelectedForGraph((current) => {
      const merged = Array.from(new Set([...current, ...requestedIds]));
      if (merged.length === current.length) return current;
      window.localStorage.setItem(
        GRAPH_SELECTION_STORAGE_KEY,
        JSON.stringify(merged),
      );
      return merged;
    });
  }, [idsKey, requestedIds]);

  // ── Computed ────────────────────────────────────────────────────────────

  const selectedNode = useMemo(
    () => graphData?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [graphData, selectedNodeId],
  );

  const selectedDetails = selectedNodeId ? detailsById[selectedNodeId] : undefined;

  const visibleEdges = useMemo(() => {
    if (!graphData) return [] as GraphEdge[];
    return graphData.edges.filter((edge) => {
      if (edge.type === "co-author" && !showCoAuthorEdges) return false;
      if (edge.type === "same-field" && !showSameFieldEdges) return false;
      return true;
    });
  }, [graphData, showCoAuthorEdges, showSameFieldEdges]);

  // Category → color mapping for legend
  const categoryColorMap = useMemo(() => {
    if (!graphData) return new Map<string, string>();
    const categories = Array.from(
      new Set(graphData.nodes.map((n) => primaryCategory(n))),
    );
    return new Map(
      categories.map((cat, i) => [cat, COLOR_PALETTE[i % COLOR_PALETTE.length]]),
    );
  }, [graphData]);

  // ── Fetch graph data ────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function fetchGraph() {
      if (requestedIds.length === 0) {
        setGraphData({ nodes: [], edges: [] });
        setGraphError(null);
        return;
      }

      setIsLoadingGraph(true);
      setGraphError(null);
      setSelectedNodeId(null);

      try {
        const response = await fetch("/api/graph", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ arxiv_ids: requestedIds }),
        });

        if (!response.ok) {
          throw new Error("Could not load graph data. Please try again.");
        }

        const data = (await response.json()) as GraphResponse;
        if (!cancelled) {
          setGraphData({
            nodes: Array.isArray(data.nodes) ? data.nodes : [],
            edges: Array.isArray(data.edges) ? data.edges : [],
          });
        }
      } catch (error) {
        if (!cancelled) {
          setGraphData({ nodes: [], edges: [] });
          setGraphError(
            error instanceof Error ? error.message : "Could not load graph data.",
          );
        }
      } finally {
        if (!cancelled) setIsLoadingGraph(false);
      }
    }

    void fetchGraph();
    return () => { cancelled = true; };
  }, [idsKey, requestedIds]);

  // ── D3 simulation ───────────────────────────────────────────────────────

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement || !graphData || graphData.nodes.length === 0) return;

    const svg = d3.select(svgElement);
    svg.selectAll("*").remove();

    const nodes: SimNode[] = graphData.nodes.map((node) => ({ ...node }));
    const links: SimLink[] = visibleEdges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      type: edge.type,
      weight: edge.weight,
    }));

    const categories = Array.from(new Set(nodes.map((n) => primaryCategory(n))));
    const colorScale = d3
      .scaleOrdinal<string, string>()
      .domain(categories)
      .range(COLOR_PALETTE.map((_, i) => COLOR_PALETTE[i % COLOR_PALETTE.length]));

    const radius = (node: SimNode) => 7 + clampScore(node.relevance_score) * 12;

    const zoomLayer = svg.append("g").attr("class", "zoom-layer");
    const edgeLayer = zoomLayer.append("g");
    const nodeLayer = zoomLayer.append("g");
    const labelLayer = zoomLayer.append("g");

    const linkSelection = edgeLayer
      .selectAll("line")
      .data(links)
      .join("line")
      .style("stroke", (link) => EDGE_COLORS[link.type])
      .style("stroke-width", (link) =>
        link.type === "co-author" ? 1.5 + Math.min(2, link.weight - 1) : 1,
      )
      .style("stroke-opacity", (link) =>
        link.type === "co-author" ? 0.85 : 0.4,
      )
      .style("stroke-dasharray", (link) =>
        link.type === "same-field" ? "5 4" : "none",
      );

    const dragBehavior = d3
      .drag<SVGCircleElement, SimNode>()
      .on("start", (event, node) => {
        if (!event.active) simulation.alphaTarget(0.35).restart();
        node.fx = node.x;
        node.fy = node.y;
      })
      .on("drag", (event, node) => {
        node.fx = event.x;
        node.fy = event.y;
      })
      .on("end", (event, node) => {
        if (!event.active) simulation.alphaTarget(0);
        node.fx = null;
        node.fy = null;
      });

    const nodeSelection = nodeLayer
      .selectAll<SVGCircleElement, SimNode>("circle")
      .data(nodes)
      .join("circle")
      .attr("r", radius)
      .style("fill", (node) => colorScale(primaryCategory(node)))
      .style("stroke", "#050d1a")
      .style("stroke-width", 1.5)
      .style("cursor", "pointer")
      .on("mouseenter", (event, node) => {
        setTooltip({ x: event.clientX, y: event.clientY, node });
        d3.select(event.currentTarget).style("stroke", "#22d3ee").style("stroke-width", 2.5);
      })
      .on("mousemove", (event, node) => {
        setTooltip({ x: event.clientX, y: event.clientY, node });
      })
      .on("mouseleave", (event) => {
        setTooltip(null);
        d3.select(event.currentTarget).style("stroke", "#050d1a").style("stroke-width", 1.5);
      })
      .on("click", (event, node) => {
        event.stopPropagation();
        setSelectedNodeId(node.id);
      })
      .call(dragBehavior);

    const labelSelection = labelLayer
      .selectAll("text")
      .data(nodes)
      .join("text")
      .text((node) => truncateLabel(node.title, 22))
      .style("font-size", "10px")
      .style("font-family", "ui-sans-serif, system-ui, sans-serif")
      .style("fill", "#94a3b8")
      .style("pointer-events", "none")
      .style("text-shadow", "0 1px 4px rgba(5,13,26,1)");

    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(links)
          .id((node) => node.id)
          .distance(130)
          .strength(0.4),
      )
      .force("charge", d3.forceManyBody().strength(-280))
      .force("center", d3.forceCenter(SVG_WIDTH / 2, SVG_HEIGHT / 2))
      .force(
        "collision",
        d3.forceCollide<SimNode>().radius((node) => radius(node) + 14),
      )
      .alpha(0.95)
      .alphaDecay(0.03);

    simulation.on("tick", () => {
      linkSelection
        .attr("x1", (link) => (link.source as SimNode).x ?? 0)
        .attr("y1", (link) => (link.source as SimNode).y ?? 0)
        .attr("x2", (link) => (link.target as SimNode).x ?? 0)
        .attr("y2", (link) => (link.target as SimNode).y ?? 0);

      nodeSelection
        .attr("cx", (node) => node.x ?? 0)
        .attr("cy", (node) => node.y ?? 0);

      labelSelection
        .attr("x", (node) => (node.x ?? 0) + radius(node) + 4)
        .attr("y", (node) => (node.y ?? 0) - 4);
    });

    simulationRef.current = simulation;

    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on("zoom", (event) => {
        zoomLayer.attr("transform", event.transform.toString());
      });

    svg.call(zoomBehavior).on("dblclick.zoom", null);
    zoomBehaviorRef.current = zoomBehavior;

    svg.on("click", () => {
      setSelectedNodeId(null);
      setTooltip(null);
    });

    return () => {
      simulation.stop();
      svg.selectAll("*").remove();
      if (simulationRef.current === simulation) simulationRef.current = null;
    };
  }, [graphData, visibleEdges]);

  // ── Fetch paper details on node click ──────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function fetchDetails(nodeId: string) {
      if (detailsById[nodeId]) return;

      setDetailsLoading(true);
      setDetailsError(null);

      try {
        const response = await fetch(`/api/papers/${encodeURIComponent(nodeId)}`);
        if (!response.ok) throw new Error("Could not load paper details.");
        const details = (await response.json()) as PaperDetails;
        if (!cancelled) {
          setDetailsById((current) => ({ ...current, [nodeId]: details }));
        }
      } catch (error) {
        if (!cancelled) {
          setDetailsError(
            error instanceof Error ? error.message : "Could not load paper details.",
          );
        }
      } finally {
        if (!cancelled) setDetailsLoading(false);
      }
    }

    if (selectedNodeId) void fetchDetails(selectedNodeId);
    return () => { cancelled = true; };
  }, [detailsById, selectedNodeId]);

  // ── Zoom / layout controls ──────────────────────────────────────────────

  const handleZoomBy = useCallback((factor: number) => {
    const svgElement = svgRef.current;
    const zoomBehavior = zoomBehaviorRef.current;
    if (!svgElement || !zoomBehavior) return;
    d3.select(svgElement).transition().duration(220).call(zoomBehavior.scaleBy, factor);
  }, []);

  const handleResetLayout = useCallback(() => {
    const simulation = simulationRef.current;
    if (!simulation) return;

    for (const node of simulation.nodes()) {
      node.fx = null;
      node.fy = null;
      node.x = SVG_WIDTH / 2 + (Math.random() - 0.5) * 200;
      node.y = SVG_HEIGHT / 2 + (Math.random() - 0.5) * 200;
      node.vx = 0;
      node.vy = 0;
    }
    simulation.alpha(1).restart();

    const svgElement = svgRef.current;
    const zoomBehavior = zoomBehaviorRef.current;
    if (svgElement && zoomBehavior) {
      d3.select(svgElement)
        .transition()
        .duration(220)
        .call(zoomBehavior.transform, d3.zoomIdentity);
    }
  }, []);

  // ── Summarize selected node ─────────────────────────────────────────────

  async function summarizeSelectedNode() {
    if (!selectedNodeId) return;
    const nodeId = selectedNodeId;

    setSummaryLoadingById((current) => ({ ...current, [nodeId]: true }));
    setSummaryErrorById((current) => ({ ...current, [nodeId]: "" }));

    try {
      const response = await fetch(
        `/api/papers/${encodeURIComponent(nodeId)}/summarize`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error("Summary unavailable right now.");
      const data = (await response.json()) as { arxiv_id: string; summary: string };
      setSummaryById((current) => ({ ...current, [nodeId]: data.summary }));
    } catch (error) {
      setSummaryErrorById((current) => ({
        ...current,
        [nodeId]: error instanceof Error ? error.message : "Summary unavailable.",
      }));
    } finally {
      setSummaryLoadingById((current) => ({ ...current, [nodeId]: false }));
    }
  }

  const summaryText = selectedNodeId ? summaryById[selectedNodeId] : "";
  const summaryLoading = selectedNodeId ? summaryLoadingById[selectedNodeId] : false;
  const summaryError = selectedNodeId ? summaryErrorById[selectedNodeId] : "";

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <main
      className="min-h-screen"
      style={{ backgroundColor: "var(--bg-page)", color: "var(--text-primary)" }}
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <Nav selectedIds={selectedForGraph} />

        {/* Page header */}
        <header
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[18px] p-4"
          style={{
            border: "1px solid var(--border-default)",
            backgroundColor: "var(--bg-surface)",
          }}
        >
          <div>
            <h1
              className="text-xl font-bold tracking-tight sm:text-2xl"
              style={{ color: "var(--text-primary)" }}
            >
              Research Graph
            </h1>
            <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
              Interactive relationship map — edges show shared authors or research fields, not citations.
            </p>
          </div>
          <Link
            href="/"
            className="rounded-xl px-4 py-2 text-sm font-medium transition-colors hover:opacity-80"
            style={{
              border: "1px solid var(--border-default)",
              backgroundColor: "var(--bg-elevated)",
              color: "var(--text-secondary)",
            }}
          >
            ← Back to Search
          </Link>
        </header>

        {/* Empty state — no IDs */}
        {requestedIds.length === 0 && (
          <div
            className="rounded-[18px] p-10 text-center"
            style={{
              border: "1px dashed var(--border-subtle)",
              backgroundColor: "var(--bg-surface)",
            }}
            role="status"
          >
            <p className="text-lg font-medium" style={{ color: "var(--text-primary)" }}>
              No papers selected
            </p>
            <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
              Go back to search, select papers using{" "}
              <strong style={{ color: "var(--text-accent)" }}>Add to Graph</strong>,
              then open this page.
            </p>
            <Link
              href="/"
              className="mt-4 inline-block rounded-xl px-5 py-2 text-sm font-semibold transition-colors hover:opacity-80"
              style={{ backgroundColor: "var(--cyan-primary)", color: "var(--cyan-text)" }}
            >
              Go to Search
            </Link>
          </div>
        )}

        {/* Graph + sidebar */}
        {requestedIds.length > 0 && (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">

            {/* Graph panel */}
            <section
              className="rounded-[18px] p-4"
              style={{
                border: "1px solid var(--border-default)",
                backgroundColor: "var(--bg-surface)",
              }}
              aria-label="Research relationship graph"
            >
              {/* Controls bar */}
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                {/* Zoom / layout */}
                <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Graph controls">
                  <button
                    type="button"
                    onClick={() => handleZoomBy(1.25)}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:opacity-80"
                    style={{
                      border: "1px solid var(--border-subtle)",
                      backgroundColor: "var(--bg-elevated)",
                      color: "var(--text-secondary)",
                    }}
                    aria-label="Zoom in"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => handleZoomBy(0.8)}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:opacity-80"
                    style={{
                      border: "1px solid var(--border-subtle)",
                      backgroundColor: "var(--bg-elevated)",
                      color: "var(--text-secondary)",
                    }}
                    aria-label="Zoom out"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={handleResetLayout}
                    className="rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors hover:opacity-80"
                    style={{
                      backgroundColor: "var(--cyan-primary)",
                      color: "var(--cyan-text)",
                    }}
                    aria-label="Reset graph layout"
                  >
                    Reset
                  </button>
                </div>

                {/* Edge type filters */}
                <div
                  className="flex flex-wrap items-center gap-2"
                  role="group"
                  aria-label="Edge type filters"
                >
                  <label
                    className="flex cursor-pointer items-center gap-2 rounded-full px-3 py-1 text-xs"
                    style={{
                      border: "1px solid var(--border-subtle)",
                      backgroundColor: "var(--bg-elevated)",
                      color: showCoAuthorEdges ? "#22d3ee" : "var(--text-muted)",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={showCoAuthorEdges}
                      onChange={(event) => setShowCoAuthorEdges(event.target.checked)}
                      className="accent-cyan-400"
                      aria-label="Show co-author edges (shared authors between papers)"
                    />
                    <span
                      className="inline-block h-2.5 w-5 rounded-sm"
                      style={{ backgroundColor: EDGE_COLORS["co-author"] }}
                      aria-hidden="true"
                    />
                    Co-author
                  </label>
                  <label
                    className="flex cursor-pointer items-center gap-2 rounded-full px-3 py-1 text-xs"
                    style={{
                      border: "1px solid var(--border-subtle)",
                      backgroundColor: "var(--bg-elevated)",
                      color: showSameFieldEdges ? "var(--text-secondary)" : "var(--text-muted)",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={showSameFieldEdges}
                      onChange={(event) => setShowSameFieldEdges(event.target.checked)}
                      className="accent-cyan-400"
                      aria-label="Show same-field edges (shared arXiv categories between papers)"
                    />
                    <span
                      className="inline-block h-px w-5 border-t-2 border-dashed align-middle"
                      style={{ borderColor: "#64748b" }}
                      aria-hidden="true"
                    />
                    Same field
                  </label>
                </div>
              </div>

              {/* Loading state */}
              {isLoadingGraph && (
                <div
                  className="flex h-[500px] items-center justify-center rounded-xl"
                  style={{
                    border: "1px solid var(--border-subtle)",
                    backgroundColor: "var(--bg-page)",
                  }}
                  role="status"
                  aria-live="polite"
                >
                  <p
                    className="animate-pulse text-sm"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    Building graph…
                  </p>
                </div>
              )}

              {/* Error state */}
              {!isLoadingGraph && graphError && (
                <div
                  className="flex h-[500px] flex-col items-center justify-center rounded-xl px-8 text-center"
                  style={{
                    border: "1px solid var(--error-border)",
                    backgroundColor: "var(--error-bg)",
                  }}
                  role="alert"
                >
                  <p style={{ color: "#fda4af" }}>{graphError}</p>
                  <p className="mt-2 text-sm" style={{ color: "#fecaca" }}>
                    Try reloading from search results.
                  </p>
                </div>
              )}

              {/* Empty graph (no nodes returned) */}
              {!isLoadingGraph && !graphError && graphData && graphData.nodes.length === 0 && (
                <div
                  className="flex h-[500px] items-center justify-center rounded-xl px-8 text-center"
                  style={{
                    border: "1px solid var(--border-subtle)",
                    backgroundColor: "var(--bg-page)",
                  }}
                  role="status"
                >
                  <div>
                    <p style={{ color: "var(--text-primary)" }}>No nodes returned</p>
                    <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                      The selected paper IDs could not be fetched from arXiv.
                    </p>
                  </div>
                </div>
              )}

              {/* SVG graph */}
              {!isLoadingGraph && !graphError && graphData && graphData.nodes.length > 0 && (
                <>
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                    className="w-full rounded-xl"
                    style={{
                      height: "clamp(360px, 55vh, 640px)",
                      border: "1px solid var(--border-subtle)",
                      backgroundColor: "#030b15",
                    }}
                    role="img"
                    aria-label={`Research relationship graph with ${graphData.nodes.length} papers`}
                  />

                  {/* Category color legend */}
                  {categoryColorMap.size > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2" aria-label="Node color legend by category">
                      {Array.from(categoryColorMap.entries()).map(([cat, color]) => (
                        <div key={cat} className="flex items-center gap-1.5">
                          <span
                            className="inline-block h-3 w-3 rounded-full"
                            style={{ backgroundColor: color }}
                            aria-hidden="true"
                          />
                          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                            {cat}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Edge relationship legend */}
                  <div
                    className="mt-2 rounded-lg px-3 py-2 text-xs"
                    style={{
                      backgroundColor: "var(--bg-page)",
                      border: "1px solid var(--border-subtle)",
                      color: "var(--text-muted)",
                    }}
                    aria-label="Edge type legend"
                  >
                    <span className="mr-4">
                      <span
                        className="mr-1.5 inline-block h-1.5 w-5 rounded-sm align-middle"
                        style={{ backgroundColor: EDGE_COLORS["co-author"] }}
                        aria-hidden="true"
                      />
                      Solid cyan = shared author(s)
                    </span>
                    <span>
                      <span
                        className="mr-1.5 inline-block h-px w-5 border-t-2 border-dashed align-middle"
                        style={{ borderColor: "#475569" }}
                        aria-hidden="true"
                      />
                      Dashed grey = shared arXiv category
                    </span>
                    <span className="ml-4 italic" style={{ color: "var(--text-muted)" }}>
                      — These are not citation relationships.
                    </span>
                  </div>
                </>
              )}
            </section>

            {/* Details sidebar */}
            <aside
              className="rounded-[18px] p-4"
              style={{
                border: "1px solid var(--border-default)",
                backgroundColor: "var(--bg-surface)",
              }}
              aria-label="Selected paper details"
            >
              <h2
                className="mb-3 text-base font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                Paper Details
              </h2>

              {!selectedNode && (
                <div
                  className="rounded-xl p-4 text-sm"
                  style={{
                    border: "1px solid var(--border-subtle)",
                    backgroundColor: "var(--bg-page)",
                    color: "var(--text-secondary)",
                  }}
                >
                  Click any node to inspect the paper, open the PDF, and generate a summary.
                </div>
              )}

              {selectedNode && (
                <div className="space-y-3">
                  {/* arXiv ID */}
                  <div
                    className="rounded-xl p-3"
                    style={{
                      border: "1px solid var(--border-subtle)",
                      backgroundColor: "var(--bg-page)",
                    }}
                  >
                    <p
                      className="mb-1 text-xs font-bold uppercase tracking-widest"
                      style={{ color: "var(--text-accent-dim)" }}
                    >
                      arXiv ID
                    </p>
                    <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {selectedNode.id}
                    </p>
                  </div>

                  {/* Title + metadata */}
                  <div
                    className="rounded-xl p-3"
                    style={{
                      border: "1px solid var(--border-subtle)",
                      backgroundColor: "var(--bg-page)",
                    }}
                  >
                    <h3
                      className="text-sm font-semibold leading-snug"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {selectedNode.title}
                    </h3>
                    <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                      {selectedNode.authors.slice(0, 4).join(", ") || "Unknown authors"}
                      {selectedNode.authors.length > 4 &&
                        ` +${selectedNode.authors.length - 4} more`}
                    </p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      Published: {formatDate(selectedNode.published)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selectedNode.categories.slice(0, 6).map((category) => (
                        <span
                          key={`${selectedNode.id}-${category}`}
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
                  </div>

                  {/* Abstract */}
                  <div
                    className="rounded-xl p-3"
                    style={{
                      border: "1px solid var(--border-subtle)",
                      backgroundColor: "var(--bg-page)",
                    }}
                  >
                    {detailsLoading && (
                      <p
                        className="animate-pulse text-xs"
                        style={{ color: "var(--text-secondary)" }}
                        aria-live="polite"
                      >
                        Loading abstract…
                      </p>
                    )}
                    {!detailsLoading && detailsError && (
                      <p className="text-xs" style={{ color: "#fda4af" }} role="alert">
                        {detailsError}
                      </p>
                    )}
                    {!detailsLoading && !detailsError && (
                      <>
                        <p
                          className="mb-2 text-xs font-bold uppercase tracking-widest"
                          style={{ color: "var(--text-accent-dim)" }}
                        >
                          Abstract
                        </p>
                        <p
                          className="text-xs leading-6"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {selectedDetails?.abstract ?? "Abstract unavailable."}
                        </p>
                      </>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={summarizeSelectedNode}
                      disabled={summaryLoading}
                      className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                      style={{
                        backgroundColor: "var(--cyan-primary)",
                        color: "var(--cyan-text)",
                      }}
                      onMouseEnter={(e) => {
                        if (!summaryLoading)
                          e.currentTarget.style.backgroundColor = "var(--cyan-hover)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "var(--cyan-primary)";
                      }}
                      aria-label={
                        summaryLoading
                          ? "Generating summary…"
                          : `Summarize: ${selectedNode.title}`
                      }
                    >
                      {summaryLoading ? "Summarizing…" : "Summarize"}
                    </button>

                    {selectedDetails?.pdf_url && (
                      <a
                        href={selectedDetails.pdf_url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors hover:opacity-80"
                        style={{
                          border: "1px solid var(--border-default)",
                          backgroundColor: "var(--bg-elevated)",
                          color: "var(--text-secondary)",
                        }}
                        aria-label={`Open PDF for: ${selectedNode.title}`}
                      >
                        PDF ↗
                      </a>
                    )}
                  </div>

                  {/* Summary error */}
                  {summaryError && (
                    <div
                      className="rounded-xl p-3 text-xs"
                      style={{
                        border: "1px solid var(--error-border)",
                        backgroundColor: "var(--error-bg)",
                        color: "#fda4af",
                      }}
                      role="alert"
                    >
                      {summaryError}
                    </div>
                  )}

                  {/* Summary text */}
                  {summaryText && (
                    <div
                      className="rounded-xl p-3"
                      style={{
                        border: "1px solid rgba(6,182,212,0.2)",
                        backgroundColor: "var(--bg-page)",
                      }}
                      role="region"
                      aria-label="AI-generated summary"
                    >
                      <p
                        className="mb-1.5 text-xs font-bold uppercase tracking-widest"
                        style={{ color: "var(--text-accent-dim)" }}
                      >
                        AI Summary
                      </p>
                      <p className="text-xs leading-6" style={{ color: "var(--text-secondary)" }}>
                        {summaryText}
                      </p>
                      <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                        ⚠ Based on abstract only.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </aside>
          </div>
        )}

        {/* Tooltip */}
        {tooltip && (
          <div
            className="pointer-events-none fixed z-50 max-w-72 rounded-xl p-3 text-xs shadow-2xl"
            style={{
              left: Math.min(tooltip.x + 16, window.innerWidth - 300),
              top: tooltip.y + 16,
              border: "1px solid var(--border-default)",
              backgroundColor: "rgba(11,22,40,0.97)",
              color: "var(--text-primary)",
            }}
            role="tooltip"
          >
            <p
              className="mb-1 line-clamp-2 text-sm font-semibold leading-snug"
              style={{ color: "var(--text-accent)" }}
            >
              {tooltip.node.title}
            </p>
            <p style={{ color: "var(--text-secondary)" }}>
              {tooltip.node.authors.slice(0, 3).join(", ") || "Unknown authors"}
            </p>
            <p className="mt-1" style={{ color: "var(--text-muted)" }}>
              {formatDate(tooltip.node.published)}
            </p>
            {tooltip.node.categories.length > 0 && (
              <p className="mt-1" style={{ color: "var(--text-muted)" }}>
                {tooltip.node.categories.slice(0, 3).join(", ")}
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

// ─── Suspense wrapper ─────────────────────────────────────────────────────────

function GraphPageFallback() {
  return (
    <main
      className="min-h-screen"
      style={{ backgroundColor: "var(--bg-page)", color: "var(--text-primary)" }}
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div
          className="flex h-[500px] items-center justify-center rounded-[18px]"
          style={{
            border: "1px solid var(--border-subtle)",
            backgroundColor: "var(--bg-surface)",
          }}
          role="status"
          aria-live="polite"
        >
          <p
            className="animate-pulse text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            Loading graph…
          </p>
        </div>
      </div>
    </main>
  );
}

export default function GraphPage() {
  return (
    <Suspense fallback={<GraphPageFallback />}>
      <GraphPageContent />
    </Suspense>
  );
}
