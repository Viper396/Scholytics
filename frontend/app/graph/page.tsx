"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as d3 from "d3";
import Nav from "../../components/Nav";

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

const SVG_WIDTH = 1200;
const SVG_HEIGHT = 720;
const GRAPH_SELECTION_STORAGE_KEY = "scholytics.selectedForGraph";

const COLOR_PALETTE = [
  "#06b6d4",
  "#38bdf8",
  "#22c55e",
  "#f59e0b",
  "#fb7185",
  "#a78bfa",
  "#14b8a6",
  "#f97316",
];

function parseIdsParam(value: string | null): string[] {
  if (!value) {
    return [];
  }

  const seen = new Set<string>();
  const ids: string[] = [];

  for (const rawId of value.split(",")) {
    const id = rawId.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

function primaryCategory(node: GraphNode): string {
  return node.categories?.[0] ?? "unknown";
}

function truncateLabel(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

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

export default function GraphPage() {
  const searchParams = useSearchParams();
  const requestedIds = useMemo(
    () => parseIdsParam(searchParams.get("ids")),
    [searchParams],
  );
  const idsKey = useMemo(() => requestedIds.join(","), [requestedIds]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<
    SVGSVGElement,
    unknown
  > | null>(null);

  const [graphData, setGraphData] = useState<GraphResponse | null>(null);
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);

  const [showCoAuthorEdges, setShowCoAuthorEdges] = useState(true);
  const [showSameFieldEdges, setShowSameFieldEdges] = useState(true);

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [detailsById, setDetailsById] = useState<Record<string, PaperDetails>>(
    {},
  );
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  const [summaryById, setSummaryById] = useState<Record<string, string>>({});
  const [summaryLoadingById, setSummaryLoadingById] = useState<
    Record<string, boolean>
  >({});
  const [summaryErrorById, setSummaryErrorById] = useState<
    Record<string, string>
  >({});
  const [selectedForGraph, setSelectedForGraph] = useState<string[]>([]);

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
    if (requestedIds.length === 0) {
      return;
    }

    setSelectedForGraph((current) => {
      const merged = Array.from(new Set([...current, ...requestedIds]));
      if (merged.length === current.length) {
        return current;
      }
      window.localStorage.setItem(
        GRAPH_SELECTION_STORAGE_KEY,
        JSON.stringify(merged),
      );
      return merged;
    });
  }, [idsKey, requestedIds]);

  const selectedNode = useMemo(
    () => graphData?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [graphData, selectedNodeId],
  );

  const selectedDetails = selectedNodeId
    ? detailsById[selectedNodeId]
    : undefined;

  const visibleEdges = useMemo(() => {
    if (!graphData) {
      return [] as GraphEdge[];
    }

    return graphData.edges.filter((edge) => {
      if (edge.type === "co-author" && !showCoAuthorEdges) {
        return false;
      }
      if (edge.type === "same-field" && !showSameFieldEdges) {
        return false;
      }
      return true;
    });
  }, [graphData, showCoAuthorEdges, showSameFieldEdges]);

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
            error instanceof Error
              ? error.message
              : "Could not load graph data.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingGraph(false);
        }
      }
    }

    void fetchGraph();

    return () => {
      cancelled = true;
    };
  }, [idsKey, requestedIds]);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement || !graphData || graphData.nodes.length === 0) {
      return;
    }

    const svg = d3.select(svgElement);
    svg.selectAll("*").remove();

    const nodes: SimNode[] = graphData.nodes.map((node) => ({ ...node }));
    const links: SimLink[] = visibleEdges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      type: edge.type,
      weight: edge.weight,
    }));

    const categories = Array.from(
      new Set(nodes.map((node) => primaryCategory(node))),
    );
    const colorScale = d3
      .scaleOrdinal<string, string>()
      .domain(categories)
      .range(
        COLOR_PALETTE.map(
          (color, index) => COLOR_PALETTE[index % COLOR_PALETTE.length],
        ),
      );

    const weightScale = d3
      .scaleLinear()
      .domain(d3.extent(links, (link) => link.weight) as [number, number])
      .range([0.2, 0.9]);

    const radius = (node: SimNode) => 8 + clampScore(node.relevance_score) * 14;

    const zoomLayer = svg.append("g").attr("class", "zoom-layer");
    const edgeLayer = zoomLayer.append("g");
    const nodeLayer = zoomLayer.append("g");
    const labelLayer = zoomLayer.append("g");

    const linkSelection = edgeLayer
      .selectAll("line")
      .data(links)
      .join("line")
      .style("stroke", "#94a3b8")
      .style(
        "stroke-width",
        (link) => 1 + Math.min(4, Math.max(1, link.weight)),
      )
      .style("stroke-opacity", (link) => {
        if (!Number.isFinite(link.weight)) {
          return 0.4;
        }
        const opacity = weightScale(link.weight);
        return Number.isFinite(opacity) ? opacity : 0.4;
      })
      .style("stroke-dasharray", (link) =>
        link.type === "same-field" ? "6 4" : "none",
      );

    const dragBehavior = d3
      .drag<SVGCircleElement, SimNode>()
      .on("start", (event, node) => {
        if (!event.active) {
          simulation.alphaTarget(0.35).restart();
        }
        node.fx = node.x;
        node.fy = node.y;
      })
      .on("drag", (event, node) => {
        node.fx = event.x;
        node.fy = event.y;
      })
      .on("end", (event, node) => {
        if (!event.active) {
          simulation.alphaTarget(0);
        }
        node.fx = null;
        node.fy = null;
      });

    const nodeSelection = nodeLayer
      .selectAll<SVGCircleElement, SimNode>("circle")
      .data(nodes)
      .join("circle")
      .attr("r", radius)
      .style("fill", (node) => colorScale(primaryCategory(node)))
      .style("stroke", "#0f172a")
      .style("stroke-width", 1.5)
      .style("cursor", "pointer")
      .on("mouseenter", (event, node) => {
        setTooltip({ x: event.clientX, y: event.clientY, node });
      })
      .on("mousemove", (event, node) => {
        setTooltip({ x: event.clientX, y: event.clientY, node });
      })
      .on("mouseleave", () => {
        setTooltip(null);
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
      .text((node) => truncateLabel(node.title, 20))
      .style("font-size", "11px")
      .style("font-family", "ui-sans-serif, system-ui")
      .style("fill", "#e2e8f0")
      .style("pointer-events", "none")
      .style("text-shadow", "0 1px 2px rgba(2, 6, 23, 0.95)");

    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(links)
          .id((node) => node.id)
          .distance(125)
          .strength(0.38),
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(SVG_WIDTH / 2, SVG_HEIGHT / 2))
      .force(
        "collision",
        d3.forceCollide<SimNode>().radius((node) => radius(node) + 12),
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
        .attr("x", (node) => (node.x ?? 0) + 10)
        .attr("y", (node) => (node.y ?? 0) - 10);
    });

    simulationRef.current = simulation;

    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 3.2])
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
      if (simulationRef.current === simulation) {
        simulationRef.current = null;
      }
    };
  }, [graphData, visibleEdges]);

  useEffect(() => {
    let cancelled = false;

    async function fetchDetails(nodeId: string) {
      if (detailsById[nodeId]) {
        return;
      }

      setDetailsLoading(true);
      setDetailsError(null);

      try {
        const response = await fetch(
          `/api/papers/${encodeURIComponent(nodeId)}`,
        );
        if (!response.ok) {
          throw new Error("Could not load paper details.");
        }

        const details = (await response.json()) as PaperDetails;
        if (!cancelled) {
          setDetailsById((current) => ({ ...current, [nodeId]: details }));
        }
      } catch (error) {
        if (!cancelled) {
          setDetailsError(
            error instanceof Error
              ? error.message
              : "Could not load paper details.",
          );
        }
      } finally {
        if (!cancelled) {
          setDetailsLoading(false);
        }
      }
    }

    if (selectedNodeId) {
      void fetchDetails(selectedNodeId);
    }

    return () => {
      cancelled = true;
    };
  }, [detailsById, selectedNodeId]);

  const handleZoomBy = useCallback((factor: number) => {
    const svgElement = svgRef.current;
    const zoomBehavior = zoomBehaviorRef.current;
    if (!svgElement || !zoomBehavior) {
      return;
    }

    d3.select(svgElement)
      .transition()
      .duration(220)
      .call(zoomBehavior.scaleBy, factor);
  }, []);

  const handleResetLayout = useCallback(() => {
    const simulation = simulationRef.current;
    if (!simulation) {
      return;
    }

    for (const node of simulation.nodes()) {
      node.fx = null;
      node.fy = null;
      node.x = SVG_WIDTH / 2 + (Math.random() - 0.5) * 220;
      node.y = SVG_HEIGHT / 2 + (Math.random() - 0.5) * 220;
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

  async function summarizeSelectedNode() {
    if (!selectedNodeId) {
      return;
    }

    setSummaryLoadingById((current) => ({
      ...current,
      [selectedNodeId]: true,
    }));
    setSummaryErrorById((current) => ({ ...current, [selectedNodeId]: "" }));

    try {
      const response = await fetch(
        `/api/papers/${encodeURIComponent(selectedNodeId)}/summarize`,
        { method: "POST" },
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
        [selectedNodeId]: data.summary,
      }));
    } catch (error) {
      setSummaryErrorById((current) => ({
        ...current,
        [selectedNodeId]:
          error instanceof Error
            ? error.message
            : "Summary unavailable right now.",
      }));
    } finally {
      setSummaryLoadingById((current) => ({
        ...current,
        [selectedNodeId]: false,
      }));
    }
  }

  const summaryText = selectedNodeId ? summaryById[selectedNodeId] : "";
  const summaryLoading = selectedNodeId
    ? summaryLoadingById[selectedNodeId]
    : false;
  const summaryError = selectedNodeId ? summaryErrorById[selectedNodeId] : "";

  return (
    <main className="min-h-screen bg-slate-900 px-5 pb-8 pt-6 text-slate-100 md:px-8">
      <div className="mx-auto w-full max-w-375">
        <Nav selectedIds={selectedForGraph} />

        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-50 md:text-4xl">
              Research Graph
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Interactive relationship map for selected arXiv papers
            </p>
          </div>
          <Link
            href="/"
            className="rounded-full border border-slate-600 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-400 hover:text-white"
          >
            Back to Search
          </Link>
        </header>

        {requestedIds.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-800/40 p-10 text-center">
            <p className="text-lg text-slate-300">
              No paper IDs were provided. Open this page with an ids query
              string.
            </p>
            <p className="mt-2 text-sm text-slate-400">
              Example: /graph?ids=2401.12345,2402.54321
            </p>
          </div>
        )}

        {requestedIds.length > 0 && (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="rounded-2xl border border-slate-700 bg-slate-800/80 p-4 shadow-xl shadow-slate-950/30">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleZoomBy(1.2)}
                    className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-slate-100 transition hover:bg-slate-600"
                  >
                    Zoom In
                  </button>
                  <button
                    type="button"
                    onClick={() => handleZoomBy(0.8)}
                    className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-slate-100 transition hover:bg-slate-600"
                  >
                    Zoom Out
                  </button>
                  <button
                    type="button"
                    onClick={handleResetLayout}
                    className="rounded-lg bg-cyan-500 px-3 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
                  >
                    Reset Layout
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 rounded-full border border-slate-600 px-3 py-1 text-xs text-slate-200">
                    <input
                      type="checkbox"
                      checked={showCoAuthorEdges}
                      onChange={(event) =>
                        setShowCoAuthorEdges(event.target.checked)
                      }
                      className="accent-cyan-400"
                    />
                    co-author
                  </label>
                  <label className="flex items-center gap-2 rounded-full border border-slate-600 px-3 py-1 text-xs text-slate-200">
                    <input
                      type="checkbox"
                      checked={showSameFieldEdges}
                      onChange={(event) =>
                        setShowSameFieldEdges(event.target.checked)
                      }
                      className="accent-cyan-400"
                    />
                    same-field
                  </label>
                </div>
              </div>

              {isLoadingGraph && (
                <div className="flex h-155 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/70">
                  <p className="animate-pulse text-sm text-slate-300">
                    Loading graph...
                  </p>
                </div>
              )}

              {!isLoadingGraph && graphError && (
                <div className="flex h-155 flex-col items-center justify-center rounded-xl border border-rose-500/40 bg-rose-500/10 px-8 text-center">
                  <p className="text-rose-100">{graphError}</p>
                  <p className="mt-2 text-sm text-rose-200/80">
                    Try reloading this page from search results.
                  </p>
                </div>
              )}

              {!isLoadingGraph &&
                !graphError &&
                graphData &&
                graphData.nodes.length === 0 && (
                  <div className="flex h-155 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/70 px-8 text-center">
                    <p className="text-slate-300">
                      No nodes were returned for the selected papers.
                    </p>
                  </div>
                )}

              {!isLoadingGraph &&
                !graphError &&
                graphData &&
                graphData.nodes.length > 0 && (
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                    className="h-155 w-full rounded-xl border border-slate-700 bg-slate-900/90"
                  />
                )}
            </section>

            <aside className="rounded-2xl border border-slate-700 bg-slate-800/80 p-4 shadow-xl shadow-slate-950/30">
              <h2 className="mb-3 text-lg font-semibold text-slate-100">
                Paper Details
              </h2>

              {!selectedNode && (
                <p className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-300">
                  Click any node to inspect the paper details, open the PDF, and
                  generate a summary.
                </p>
              )}

              {selectedNode && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                    <p className="text-xs uppercase tracking-wide text-cyan-300">
                      arXiv ID
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-100">
                      {selectedNode.id}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                    <h3 className="text-base font-semibold leading-6 text-slate-100">
                      {selectedNode.title}
                    </h3>
                    <p className="mt-2 text-sm text-slate-300">
                      {selectedNode.authors.join(", ") || "Unknown authors"}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Published: {formatDate(selectedNode.published)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedNode.categories.slice(0, 6).map((category) => (
                        <span
                          key={`${selectedNode.id}-${category}`}
                          className="rounded-full border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200"
                        >
                          {category}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                    {detailsLoading && (
                      <p className="animate-pulse text-sm text-slate-300">
                        Loading full paper details...
                      </p>
                    )}
                    {!detailsLoading && detailsError && (
                      <p className="text-sm text-rose-300">{detailsError}</p>
                    )}
                    {!detailsLoading && !detailsError && (
                      <>
                        <p className="mb-2 text-xs uppercase tracking-wide text-cyan-300">
                          Abstract
                        </p>
                        <p className="text-sm leading-6 text-slate-200">
                          {selectedDetails?.abstract ?? "Abstract unavailable."}
                        </p>
                      </>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={summarizeSelectedNode}
                      disabled={summaryLoading}
                      className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {summaryLoading ? "Summarizing..." : "Summarize"}
                    </button>
                    {selectedDetails?.pdf_url && (
                      <a
                        href={selectedDetails.pdf_url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-slate-500 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-300 hover:text-white"
                      >
                        Open PDF
                      </a>
                    )}
                  </div>

                  {summaryError && (
                    <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
                      {summaryError}
                    </p>
                  )}

                  {summaryText && (
                    <div className="rounded-xl border border-cyan-400/30 bg-slate-900/60 p-3">
                      <p className="mb-2 text-xs uppercase tracking-wide text-cyan-300">
                        Summary
                      </p>
                      <p className="text-sm leading-6 text-slate-200">
                        {summaryText}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </aside>
          </div>
        )}

        {tooltip && (
          <div
            className="pointer-events-none fixed z-50 w-80 rounded-xl border border-slate-600 bg-slate-950/95 p-3 text-xs text-slate-200 shadow-2xl shadow-slate-950/40"
            style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
          >
            <p className="text-sm font-semibold text-cyan-300">
              {tooltip.node.title}
            </p>
            <p className="mt-2 text-slate-300">
              {tooltip.node.authors.join(", ") || "Unknown authors"}
            </p>
            <p className="mt-1 text-slate-400">
              Published: {formatDate(tooltip.node.published)}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
