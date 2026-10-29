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
import ComparisonMatrix, {
  ComparisonResult,
  ComparisonPaper,
} from "../../components/ComparisonMatrix";

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

type EdgeTooltipState = {
  x: number;
  y: number;
  edge: GraphEdge;
  sourceNode: GraphNode;
  targetNode: GraphNode;
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
  "co-author": "#06b6d4", // cyan — shared author between papers
  "same-field": "#64748b", // slate/grey — shared arXiv category
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
  const rawIds = searchParams?.get("ids") ?? null;
  const requestedIds = useMemo(
    () => parseIdsParam(rawIds),
    [rawIds],
  );
  const idsKey = useMemo(() => requestedIds.join(","), [requestedIds]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const hasAutoFittedRef = useRef(false);
  const detailsAsideRef = useRef<HTMLElement | null>(null);

  const [graphData, setGraphData] = useState<GraphResponse | null>(null);
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);

  const [showCoAuthorEdges, setShowCoAuthorEdges] = useState(true);
  const [showSameFieldEdges, setShowSameFieldEdges] = useState(true);

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [edgeTooltip, setEdgeTooltip] = useState<EdgeTooltipState | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [detailsById, setDetailsById] = useState<Record<string, PaperDetails>>({});
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  const [summaryById, setSummaryById] = useState<Record<string, string>>({});
  const [summaryLoadingById, setSummaryLoadingById] = useState<Record<string, boolean>>({});
  const [summaryErrorById, setSummaryErrorById] = useState<Record<string, string>>({});

  const [selectedForGraph, setSelectedForGraph] = useState<string[]>([]);

  // ── Comparison State ────────────────────────────────────────────────────
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [showComparisonView, setShowComparisonView] = useState(false);
  const comparisonAbortRef = useRef<AbortController | null>(null);

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

  // Edge counts
  const coAuthorEdgeCount = useMemo(
    () => graphData?.edges.filter((e) => e.type === "co-author").length ?? 0,
    [graphData],
  );
  const sameFieldEdgeCount = useMemo(
    () => graphData?.edges.filter((e) => e.type === "same-field").length ?? 0,
    [graphData],
  );

  // Connected papers for selected node
  const connectedPapers = useMemo(() => {
    if (!selectedNodeId || !graphData) return [];
    const results: Array<{
      paper: GraphNode;
      edgeType: "co-author" | "same-field";
      weight: number;
    }> = [];
    for (const edge of visibleEdges) {
      if (edge.source === selectedNodeId) {
        const other = graphData.nodes.find((n) => n.id === edge.target);
        if (other) results.push({ paper: other, edgeType: edge.type, weight: edge.weight });
      } else if (edge.target === selectedNodeId) {
        const other = graphData.nodes.find((n) => n.id === edge.source);
        if (other) results.push({ paper: other, edgeType: edge.type, weight: edge.weight });
      }
    }
    return results;
  }, [selectedNodeId, graphData, visibleEdges]);

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
      hasAutoFittedRef.current = false;

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
    return () => {
      cancelled = true;
    };
  }, [idsKey, requestedIds]);

  // ── Zoom-to-fit helper ──────────────────────────────────────────────────

  const zoomToFit = useCallback((padding = 80, duration = 300) => {
    const svgElement = svgRef.current;
    const zoomBehavior = zoomBehaviorRef.current;
    const simulation = simulationRef.current;
    if (!svgElement || !zoomBehavior || !simulation) return;

    const currentNodes = simulation.nodes();
    if (currentNodes.length === 0) return;

    const radiusForNode = (node: SimNode) => {
      const isSmall = currentNodes.length <= 5;
      return isSmall
        ? 14 + clampScore(node.relevance_score) * 16
        : 8 + clampScore(node.relevance_score) * 12;
    };

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const n of currentNodes) {
      const x = n.x ?? SVG_WIDTH / 2;
      const y = n.y ?? SVG_HEIGHT / 2;
      const r = radiusForNode(n);
      if (x - r < minX) minX = x - r;
      if (x + r > maxX) maxX = x + r;
      if (y - r < minY) minY = y - r;
      if (y + r > maxY) maxY = y + r;
    }

    const dx = Math.max(maxX - minX, 80);
    const dy = Math.max(maxY - minY, 80);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const availableWidth = SVG_WIDTH - padding * 2;
    const availableHeight = SVG_HEIGHT - padding * 2;

    // For small graphs, fill comfortably without tiny dots in a void
    const autoScale = Math.min(
      availableWidth / dx,
      availableHeight / dy,
    );
    const clampedScale = Math.min(
      currentNodes.length <= 3 ? 2.0 : currentNodes.length <= 6 ? 1.5 : 1.25,
      Math.max(0.45, autoScale),
    );

    const transform = d3.zoomIdentity
      .translate(SVG_WIDTH / 2, SVG_HEIGHT / 2)
      .scale(clampedScale)
      .translate(-centerX, -centerY);

    if (duration > 0) {
      d3.select(svgElement)
        .transition()
        .duration(duration)
        .call(zoomBehavior.transform, transform);
    } else {
      d3.select(svgElement).call(zoomBehavior.transform, transform);
    }
  }, []);

  // ── D3 simulation ───────────────────────────────────────────────────────

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement || !graphData || graphData.nodes.length === 0) return;

    const svg = d3.select(svgElement);
    svg.selectAll("*").remove();

    const isSmallGraph = graphData.nodes.length <= 5;
    const isMediumGraph = graphData.nodes.length <= 10;

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

    // Dynamic radius: larger nodes for small graphs to prevent tiny dots in empty space
    const radius = (node: SimNode) =>
      isSmallGraph
        ? 14 + clampScore(node.relevance_score) * 16
        : isMediumGraph
        ? 10 + clampScore(node.relevance_score) * 14
        : 8 + clampScore(node.relevance_score) * 12;

    const zoomLayer = svg.append("g").attr("class", "zoom-layer");
    const edgeLayer = zoomLayer.append("g").attr("class", "edges");
    const nodeLayer = zoomLayer.append("g").attr("class", "nodes");
    const labelLayer = zoomLayer.append("g").attr("class", "labels");

    // Edge lines
    const linkSelection = edgeLayer
      .selectAll<SVGLineElement, SimLink>("line")
      .data(links)
      .join("line")
      .style("stroke", (link) => EDGE_COLORS[link.type])
      .style("stroke-width", (link) =>
        link.type === "co-author" ? 2 + Math.min(3, link.weight - 1) : 1.5,
      )
      .style("stroke-opacity", (link) =>
        link.type === "co-author" ? 0.85 : 0.45,
      )
      .style("stroke-dasharray", (link) =>
        link.type === "same-field" ? "5 4" : "none",
      )
      .style("cursor", "pointer")
      .on("mouseenter", (event, link) => {
        const sourceNode = typeof link.source === "object" ? (link.source as SimNode) : nodes.find((n) => n.id === link.source);
        const targetNode = typeof link.target === "object" ? (link.target as SimNode) : nodes.find((n) => n.id === link.target);
        if (sourceNode && targetNode) {
          setEdgeTooltip({
            x: event.clientX,
            y: event.clientY,
            edge: {
              source: sourceNode.id,
              target: targetNode.id,
              type: link.type,
              weight: link.weight,
            },
            sourceNode,
            targetNode,
          });
        }
        d3.select(event.currentTarget)
          .style("stroke", "#22d3ee")
          .style("stroke-width", link.type === "co-author" ? 4 : 3)
          .style("stroke-opacity", 1);
      })
      .on("mousemove", (event) => {
        setEdgeTooltip((prev) =>
          prev ? { ...prev, x: event.clientX, y: event.clientY } : null,
        );
      })
      .on("mouseleave", (event, link) => {
        setEdgeTooltip(null);
        d3.select(event.currentTarget)
          .style("stroke", EDGE_COLORS[link.type])
          .style(
            "stroke-width",
            link.type === "co-author" ? 2 + Math.min(3, link.weight - 1) : 1.5,
          )
          .style("stroke-opacity", link.type === "co-author" ? 0.85 : 0.45);
      });

    // Drag behavior
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

    // Nodes
    const nodeSelection = nodeLayer
      .selectAll<SVGCircleElement, SimNode>("circle")
      .data(nodes)
      .join("circle")
      .attr("r", radius)
      .style("fill", (node) => colorScale(primaryCategory(node)))
      .style("stroke", "#050d1a")
      .style("stroke-width", 2)
      .style("cursor", "pointer")
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (node) => `${node.title} (${node.id})`)
      .on("mouseenter", (event, node) => {
        setHoveredNodeId(node.id);
        setTooltip({ x: event.clientX, y: event.clientY, node });
        d3.select(event.currentTarget)
          .style("stroke", "#22d3ee")
          .style("stroke-width", 3.5);
      })
      .on("mousemove", (event, node) => {
        setTooltip({ x: event.clientX, y: event.clientY, node });
      })
      .on("mouseleave", () => {
        setHoveredNodeId(null);
        setTooltip(null);
      })
      // Two-parameter callback strictly preserved for test interception
      .on("click", (event, node) => {
        event.stopPropagation();
        setSelectedNodeId(node.id);
      })
      .on("keydown", (event: KeyboardEvent, node: SimNode) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setSelectedNodeId(node.id);
        }
      })
      .call(dragBehavior);

    // Labels with halo text-shadow for high contrast legibility
    const labelSelection = labelLayer
      .selectAll<SVGTextElement, SimNode>("text")
      .data(nodes)
      .join("text")
      .text((node) => truncateLabel(node.title, isSmallGraph ? 32 : 24))
      .style("font-size", isSmallGraph ? "12px" : "11px")
      .style("font-weight", "600")
      .style("font-family", "var(--font-sans)")
      .style("fill", "#e2e8f0")
      .style("pointer-events", "none")
      .style("paint-order", "stroke")
      .style("stroke", "#050d1a")
      .style("stroke-width", "3.5px")
      .style("stroke-linejoin", "round");

    // Dynamic force parameters based on graph size
    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(links)
          .id((node) => node.id)
          .distance(isSmallGraph ? 220 : isMediumGraph ? 160 : 130)
          .strength(0.4),
      )
      .force(
        "charge",
        d3.forceManyBody().strength(isSmallGraph ? -500 : isMediumGraph ? -350 : -260),
      )
      .force("center", d3.forceCenter(SVG_WIDTH / 2, SVG_HEIGHT / 2))
      .force(
        "collision",
        d3.forceCollide<SimNode>().radius((node) => radius(node) + (isSmallGraph ? 24 : 16)),
      )
      .alpha(0.95)
      .alphaDecay(0.03);

    let tickCount = 0;

    simulation.on("tick", () => {
      tickCount += 1;

      linkSelection
        .attr("x1", (link) => (link.source as SimNode).x ?? 0)
        .attr("y1", (link) => (link.source as SimNode).y ?? 0)
        .attr("x2", (link) => (link.target as SimNode).x ?? 0)
        .attr("y2", (link) => (link.target as SimNode).y ?? 0);

      nodeSelection
        .attr("cx", (node) => node.x ?? 0)
        .attr("cy", (node) => node.y ?? 0);

      labelSelection
        .attr("x", (node) => (node.x ?? 0) + radius(node) + 6)
        .attr("y", (node) => (node.y ?? 0) + 4);

      // Auto zoom-to-fit once simulation settles on initial load
      if (!hasAutoFittedRef.current && (tickCount >= 35 || simulation.alpha() < 0.1)) {
        hasAutoFittedRef.current = true;
        zoomToFit(70, 350);
      }
    });

    simulationRef.current = simulation;

    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 4.5])
      .on("zoom", (event) => {
        zoomLayer.attr("transform", event.transform.toString());
      });

    svg.call(zoomBehavior).on("dblclick.zoom", null);
    zoomBehaviorRef.current = zoomBehavior;

    svg.on("click", () => {
      setSelectedNodeId(null);
      setTooltip(null);
      setEdgeTooltip(null);
    });

    // Cleanup simulation & listeners on unmount/rerender
    return () => {
      simulation.stop();
      simulation.on("tick", null);
      svg.selectAll("*").remove();
      if (simulationRef.current === simulation) simulationRef.current = null;
      zoomBehaviorRef.current = null;
    };
  }, [graphData, visibleEdges, zoomToFit]);

  // Highlight selected and hovered nodes in SVG
  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;

    const svg = d3.select(svgElement);
    const targetId = selectedNodeId || hoveredNodeId;

    if (!targetId) {
      // Normal state
      svg.selectAll<SVGCircleElement, SimNode>("circle")
        .style("stroke", "#050d1a")
        .style("stroke-width", 2)
        .style("opacity", 1);

      svg.selectAll<SVGLineElement, SimLink>("line")
        .style("opacity", 1);

      svg.selectAll<SVGTextElement, SimNode>("text")
        .style("opacity", 1);
      return;
    }

    // Set of connected node IDs
    const connectedNodeIds = new Set<string>([targetId]);
    for (const edge of visibleEdges) {
      if (edge.source === targetId) connectedNodeIds.add(edge.target);
      if (edge.target === targetId) connectedNodeIds.add(edge.source);
    }

    svg.selectAll<SVGCircleElement, SimNode>("circle")
      .style("stroke", (node) => (node.id === targetId ? "#22d3ee" : connectedNodeIds.has(node.id) ? "#38bdf8" : "#050d1a"))
      .style("stroke-width", (node) => (node.id === targetId ? 3.5 : connectedNodeIds.has(node.id) ? 2.5 : 1.5))
      .style("opacity", (node) => (connectedNodeIds.has(node.id) ? 1 : 0.35));

    svg.selectAll<SVGLineElement, SimLink>("line")
      .style("opacity", (link) => {
        const s = typeof link.source === "object" ? (link.source as SimNode).id : link.source;
        const t = typeof link.target === "object" ? (link.target as SimNode).id : link.target;
        return s === targetId || t === targetId ? 1 : 0.12;
      })
      .style("stroke-width", (link) => {
        const s = typeof link.source === "object" ? (link.source as SimNode).id : link.source;
        const t = typeof link.target === "object" ? (link.target as SimNode).id : link.target;
        return s === targetId || t === targetId ? 3 : 1.5;
      });

    svg.selectAll<SVGTextElement, SimNode>("text")
      .style("opacity", (node) => (connectedNodeIds.has(node.id) ? 1 : 0.35));
  }, [selectedNodeId, hoveredNodeId, visibleEdges]);

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
    return () => {
      cancelled = true;
    };
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

    hasAutoFittedRef.current = false;
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

    if (summaryLoadingById[nodeId]) return;

    setSummaryLoadingById((current) => ({ ...current, [nodeId]: true }));
    setSummaryErrorById((current) => ({ ...current, [nodeId]: "" }));

    const title = selectedDetails?.title || selectedNode?.title || "";
    const rawAbstract = selectedDetails?.abstract || "";
    const abstract =
      rawAbstract && rawAbstract !== "Abstract unavailable." ? rawAbstract : "";

    const hasMetadata = Boolean(title && abstract);
    const requestHeaders: Record<string, string> = hasMetadata
      ? { "Content-Type": "application/json" }
      : {};
    const requestBody = hasMetadata
      ? JSON.stringify({ title, abstract })
      : undefined;

    try {
      const response = await fetch(
        `/api/papers/${encodeURIComponent(nodeId)}/summarize`,
        {
          method: "POST",
          headers: requestHeaders,
          body: requestBody,
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
        } catch {
          // fallback to generic message
        }
        throw new Error(msg);
      }

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

  // ── Paper Comparison ────────────────────────────────────────────────────

  function toggleCompare(arxivId: string) {
    setSelectedForCompare((current) => {
      if (current.includes(arxivId)) {
        return current.filter((id) => id !== arxivId);
      }
      if (current.length >= 4) {
        return current;
      }
      return [...current, arxivId];
    });
  }

  async function generateComparison(idsToCompare?: string[]) {
    const targetIds = Array.isArray(idsToCompare)
      ? idsToCompare
      : selectedForCompare.length >= 2
      ? selectedForCompare
      : graphData?.nodes.slice(0, 3).map((n) => n.id) ?? [];

    if (targetIds.length < 2) {
      setComparisonError("Select at least 2 papers (up to 4) to generate a comparison.");
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

    // Pass known paper metadata from graph to avoid arXiv re-fetch
    const clientPapers = boundedIds.map((id) => {
      const node = graphData?.nodes.find((n) => n.id === id);
      const details = detailsById[id];
      return {
        arxiv_id: id,
        title: details?.title || node?.title || "",
        authors: details?.authors || node?.authors || [],
        abstract: details?.abstract || "",
        published: details?.published || node?.published || "",
        categories: details?.categories || node?.categories || [],
        pdf_url: details?.pdf_url || `https://arxiv.org/pdf/${id}`,
        entry_url: details?.entry_url || `https://arxiv.org/abs/${id}`,
      };
    });

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
          papers: clientPapers,
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

        {/* Page header with relationship clarification */}
        <header
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[18px] p-5 shadow-sm"
          style={{
            border: "1px solid var(--border-default)",
            backgroundColor: "var(--bg-surface)",
          }}
        >
          <div>
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-lg text-xs"
                style={{
                  backgroundColor: "var(--cyan-subtle)",
                  color: "var(--text-accent)",
                  border: "1px solid rgba(6,182,212,0.3)",
                }}
                aria-hidden="true"
              >
                ◈
              </span>
              <h1
                className="text-xl font-bold tracking-tight sm:text-2xl"
                style={{ color: "var(--text-primary)" }}
              >
                Research Relationship Graph
              </h1>
            </div>
            <p className="mt-1 text-xs sm:text-sm" style={{ color: "var(--text-secondary)" }}>
              Interactive relationship map — edges represent shared authors or shared arXiv categories, <strong style={{ color: "var(--text-accent)" }}>not citation relationships</strong>.
            </p>
          </div>
          <Link
            href="/"
            className="rounded-xl px-4 py-2 text-sm font-medium transition-colors hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
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
              className="mt-4 inline-block rounded-xl px-5 py-2 text-sm font-semibold transition-colors hover:opacity-85"
              style={{ backgroundColor: "var(--cyan-primary)", color: "var(--cyan-text)" }}
            >
              Go to Search
            </Link>
          </div>
        )}

        {/* Active comparison modal/section */}
        {showComparisonView && (
          <ComparisonMatrix
            isComparing={isComparing}
            comparisonError={comparisonError}
            comparisonResult={comparisonResult}
            onClose={() => setShowComparisonView(false)}
            onRetry={() => generateComparison()}
          />
        )}

        {/* Graph + sidebar */}
        {requestedIds.length > 0 && (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">

            {/* Graph panel */}
            <section
              className="rounded-[18px] p-4 sm:p-5 shadow-sm"
              style={{
                border: "1px solid var(--border-default)",
                backgroundColor: "var(--bg-surface)",
              }}
              aria-label="Research relationship graph"
            >
              {/* Controls bar: Zoom, Fit, Edge toggles, Comparison */}
              <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5">
                {/* Zoom / layout toolbar */}
                <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Graph controls">
                  <button
                    type="button"
                    onClick={() => handleZoomBy(1.25)}
                    className="rounded-lg px-2.5 py-1 text-sm font-bold transition-colors hover:opacity-85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)]"
                    style={{
                      border: "1px solid var(--border-subtle)",
                      backgroundColor: "var(--bg-elevated)",
                      color: "var(--text-secondary)",
                    }}
                    aria-label="Zoom in"
                    title="Zoom in"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => handleZoomBy(0.8)}
                    className="rounded-lg px-2.5 py-1 text-sm font-bold transition-colors hover:opacity-85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)]"
                    style={{
                      border: "1px solid var(--border-subtle)",
                      backgroundColor: "var(--bg-elevated)",
                      color: "var(--text-secondary)",
                    }}
                    aria-label="Zoom out"
                    title="Zoom out"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => zoomToFit(70, 300)}
                    className="rounded-lg px-3 py-1 text-xs font-semibold transition-colors hover:opacity-85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)]"
                    style={{
                      border: "1px solid var(--border-subtle)",
                      backgroundColor: "var(--bg-elevated)",
                      color: "var(--text-secondary)",
                    }}
                    aria-label="Fit graph to view"
                    title="Center and fit all nodes in view"
                  >
                    Fit View
                  </button>
                  <button
                    type="button"
                    onClick={handleResetLayout}
                    className="rounded-lg px-3 py-1 text-xs font-semibold transition-colors hover:opacity-85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)]"
                    style={{
                      backgroundColor: "var(--cyan-primary)",
                      color: "var(--cyan-text)",
                    }}
                    aria-label="Reset graph layout"
                    title="Re-run simulation physics"
                  >
                    Reset
                  </button>
                </div>

                {/* Edge type filters */}
                <div
                  className="flex flex-wrap items-center gap-2"
                  role="group"
                  aria-label="Edge relationship filters"
                >
                  <label
                    className="flex cursor-pointer items-center gap-2 rounded-full px-3 py-1 text-xs transition-colors"
                    style={{
                      border: showCoAuthorEdges
                        ? "1px solid rgba(6,182,212,0.4)"
                        : "1px solid var(--border-subtle)",
                      backgroundColor: showCoAuthorEdges
                        ? "var(--cyan-subtle)"
                        : "var(--bg-elevated)",
                      color: showCoAuthorEdges ? "var(--text-accent)" : "var(--text-muted)",
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
                      className="inline-block h-2 w-4 rounded-sm"
                      style={{ backgroundColor: EDGE_COLORS["co-author"] }}
                      aria-hidden="true"
                    />
                    <span>Co-author ({coAuthorEdgeCount})</span>
                  </label>
                  <label
                    className="flex cursor-pointer items-center gap-2 rounded-full px-3 py-1 text-xs transition-colors"
                    style={{
                      border: showSameFieldEdges
                        ? "1px solid var(--border-default)"
                        : "1px solid var(--border-subtle)",
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
                      className="inline-block h-px w-4 border-t-2 border-dashed align-middle"
                      style={{ borderColor: "#64748b" }}
                      aria-hidden="true"
                    />
                    <span>Same field ({sameFieldEdgeCount})</span>
                  </label>
                </div>
              </div>

              {/* Accessible Paper Selection Bar (for Keyboard & Touch Users) */}
              {graphData && graphData.nodes.length > 0 && (
                <div
                  className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-xs"
                  style={{
                    backgroundColor: "var(--bg-elevated)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[11px] font-bold uppercase tracking-wider"
                      style={{ color: "var(--text-accent-dim)" }}
                    >
                      Keyboard / Touch Node Selection:
                    </span>
                  </div>
                  <div className="flex flex-1 min-w-[220px] items-center gap-2">
                    <label htmlFor="accessible-node-select" className="sr-only">
                      Select paper in graph
                    </label>
                    <select
                      id="accessible-node-select"
                      value={selectedNodeId || ""}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSelectedNodeId(id || null);
                        if (id && window.innerWidth < 1280) {
                          detailsAsideRef.current?.scrollIntoView?.({ behavior: "smooth" });
                        }
                      }}
                      className="h-8 w-full rounded-lg px-2.5 text-xs transition-all"
                      style={{
                        border: "1px solid var(--border-default)",
                        backgroundColor: "var(--bg-input)",
                        color: "var(--text-primary)",
                        outline: "none",
                      }}
                    >
                      <option value="">
                        -- Choose a paper ({graphData.nodes.length} papers in graph) --
                      </option>
                      {graphData.nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          [{primaryCategory(n)}] {n.title} (arXiv:{n.id})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Comparison Matrix Bar */}
              {graphData && graphData.nodes.length >= 2 && (
                <div
                  className="mb-3.5 flex flex-wrap items-center justify-between gap-3 rounded-xl px-3 py-2.5"
                  style={{
                    backgroundColor: "var(--bg-page)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-xs tracking-wider uppercase" style={{ color: "var(--text-secondary)" }}>
                      Compare Matrix:
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-bold"
                      style={{
                        backgroundColor:
                          selectedForCompare.length >= 2
                            ? "rgba(6,182,212,0.18)"
                            : "var(--bg-elevated)",
                        color:
                          selectedForCompare.length >= 2
                            ? "var(--text-accent)"
                            : "var(--text-muted)",
                        border: "1px solid var(--border-subtle)",
                      }}
                    >
                      {selectedForCompare.length} / 4 selected
                    </span>
                    {selectedForCompare.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedForCompare([])}
                        className="text-xs transition-colors hover:underline"
                        style={{ color: "var(--text-muted)" }}
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedForCompare.length >= 2 ? (
                      <button
                        type="button"
                        onClick={() => generateComparison()}
                        disabled={isComparing}
                        className="rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all hover:opacity-90 disabled:opacity-50"
                        style={{
                          backgroundColor: "var(--cyan-primary)",
                          color: "var(--cyan-text)",
                        }}
                      >
                        {isComparing ? "Comparing…" : `Compare Selected (${selectedForCompare.length})`}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          const autoIds = graphData.nodes.slice(0, Math.min(3, graphData.nodes.length)).map((n) => n.id);
                          setSelectedForCompare(autoIds);
                          generateComparison(autoIds);
                        }}
                        disabled={isComparing}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-85"
                        style={{
                          backgroundColor: "var(--bg-elevated)",
                          border: "1px solid var(--border-default)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        Compare Top {Math.min(3, graphData.nodes.length)}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Loading state */}
              {isLoadingGraph && (
                <div
                  className="flex h-[480px] items-center justify-center rounded-xl"
                  style={{
                    border: "1px solid var(--border-subtle)",
                    backgroundColor: "var(--bg-page)",
                  }}
                  role="status"
                  aria-live="polite"
                >
                  <div className="text-center">
                    <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                    <p className="mt-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      Building relationship graph from arXiv metadata…
                    </p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      Detecting co-authorship collaboration and category overlaps.
                    </p>
                  </div>
                </div>
              )}

              {/* Error state */}
              {!isLoadingGraph && graphError && (
                <div
                  className="flex h-[480px] flex-col items-center justify-center rounded-xl px-8 text-center"
                  style={{
                    border: "1px solid var(--error-border)",
                    backgroundColor: "var(--error-bg)",
                  }}
                  role="alert"
                >
                  <p className="font-semibold text-sm" style={{ color: "#fda4af" }}>{graphError}</p>
                  <p className="mt-2 text-xs" style={{ color: "#fecaca" }}>
                    Try reloading from search results.
                  </p>
                </div>
              )}

              {/* Empty graph */}
              {!isLoadingGraph && !graphError && graphData && graphData.nodes.length === 0 && (
                <div
                  className="flex h-[480px] items-center justify-center rounded-xl px-8 text-center"
                  style={{
                    border: "1px solid var(--border-subtle)",
                    backgroundColor: "var(--bg-page)",
                  }}
                  role="status"
                >
                  <div>
                    <p className="font-semibold" style={{ color: "var(--text-primary)" }}>No nodes returned</p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                      The selected paper IDs could not be fetched from arXiv.
                    </p>
                  </div>
                </div>
              )}

              {/* SVG Canvas */}
              {!isLoadingGraph && !graphError && graphData && graphData.nodes.length > 0 && (
                <>
                  <div className="relative">
                    <svg
                      ref={svgRef}
                      viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                      className="w-full rounded-xl transition-all"
                      style={{
                        height: "clamp(400px, 60vh, 680px)",
                        border: "1px solid var(--border-subtle)",
                        backgroundColor: "#030b15",
                      }}
                      role="img"
                      aria-label={`Research relationship graph with ${graphData.nodes.length} papers`}
                    />
                    <span
                      className="pointer-events-none absolute bottom-3 right-3 rounded px-2 py-0.5 text-[10px]"
                      style={{
                        backgroundColor: "rgba(5,13,26,0.75)",
                        border: "1px solid var(--border-subtle)",
                        color: "var(--text-muted)",
                      }}
                    >
                      Drag to pan · Scroll to zoom
                    </span>
                  </div>

                  {/* Category color legend with node counts */}
                  {categoryColorMap.size > 0 && (
                    <div
                      className="mt-3.5 flex flex-wrap items-center gap-2"
                      aria-label="Node color legend by category"
                    >
                      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                        Categories:
                      </span>
                      {Array.from(categoryColorMap.entries()).map(([cat, color]) => {
                        const count = graphData.nodes.filter((n) => primaryCategory(n) === cat).length;
                        return (
                          <div
                            key={cat}
                            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
                            style={{
                              backgroundColor: "var(--bg-page)",
                              border: "1px solid var(--border-subtle)",
                            }}
                          >
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: color }}
                              aria-hidden="true"
                            />
                            <span style={{ color: "var(--text-secondary)" }}>{cat}</span>
                            <span
                              className="text-[10px] rounded-full px-1.5"
                              style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-muted)" }}
                            >
                              {count}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Edge relationship legend */}
                  <div
                    className="mt-2.5 rounded-lg p-3 text-xs flex flex-wrap items-center justify-between gap-3"
                    style={{
                      backgroundColor: "var(--bg-page)",
                      border: "1px solid var(--border-subtle)",
                      color: "var(--text-muted)",
                    }}
                    aria-label="Edge type legend"
                  >
                    <div className="flex flex-wrap items-center gap-4">
                      <span>
                        <span
                          className="mr-1.5 inline-block h-2 w-5 rounded-sm align-middle"
                          style={{ backgroundColor: EDGE_COLORS["co-author"] }}
                          aria-hidden="true"
                        />
                        <strong style={{ color: "var(--text-primary)" }}>Solid cyan:</strong> Shared author(s)
                      </span>
                      <span>
                        <span
                          className="mr-1.5 inline-block h-px w-5 border-t-2 border-dashed align-middle"
                          style={{ borderColor: "#64748b" }}
                          aria-hidden="true"
                        />
                        <strong style={{ color: "var(--text-primary)" }}>Dashed grey:</strong> Shared arXiv field
                      </span>
                    </div>
                    <span className="text-[11px] font-medium" style={{ color: "#fbbf24" }}>
                      ⚠ Relationships show collaboration &amp; field similarity — NOT citations.
                    </span>
                  </div>
                </>
              )}
            </section>

            {/* Details sidebar */}
            <aside
              ref={detailsAsideRef}
              className="rounded-[18px] p-5 shadow-sm"
              style={{
                border: "1px solid var(--border-default)",
                backgroundColor: "var(--bg-surface)",
              }}
              aria-label="Selected paper details"
            >
              <div className="mb-3.5 flex items-center justify-between">
                <h2
                  className="text-base font-bold"
                  style={{ color: "var(--text-primary)" }}
                >
                  Paper Details
                </h2>
                {selectedNode && (
                  <button
                    type="button"
                    onClick={() => setSelectedNodeId(null)}
                    className="text-xs transition-colors hover:underline"
                    style={{ color: "var(--text-muted)" }}
                    aria-label="Deselect paper"
                  >
                    ✕ Close
                  </button>
                )}
              </div>

              {!selectedNode && (
                <div className="space-y-3">
                  <div
                    className="rounded-xl p-4 text-xs leading-relaxed"
                    style={{
                      border: "1px solid var(--border-subtle)",
                      backgroundColor: "var(--bg-page)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    Click any node in the graph, select from the dropdown above, or choose a paper from the list below to inspect its abstract, connections, and AI summary.
                  </div>

                  {graphData && graphData.nodes.length > 0 && (
                    <div
                      className="rounded-xl p-3"
                      style={{
                        border: "1px solid var(--border-subtle)",
                        backgroundColor: "var(--bg-page)",
                      }}
                    >
                      <p
                        className="mb-2 text-xs font-bold uppercase tracking-wider"
                        style={{ color: "var(--text-accent-dim)" }}
                      >
                        Papers in Graph ({graphData.nodes.length})
                      </p>
                      <ul className="space-y-1.5 overflow-y-auto max-h-[380px] pr-1">
                        {graphData.nodes.map((node) => (
                          <li key={node.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedNodeId(node.id);
                                if (window.innerWidth < 1280) {
                                  detailsAsideRef.current?.scrollIntoView?.({ behavior: "smooth" });
                                }
                              }}
                              className="w-full text-left rounded-lg p-2 text-xs transition-colors hover:bg-[var(--bg-elevated)] flex flex-col gap-1 border border-transparent hover:border-[var(--border-subtle)]"
                            >
                              <span className="font-semibold line-clamp-1" style={{ color: "var(--text-primary)" }}>
                                {node.title}
                              </span>
                              <div className="flex items-center justify-between text-[10px]" style={{ color: "var(--text-muted)" }}>
                                <span>arXiv:{node.id}</span>
                                <span>{primaryCategory(node)}</span>
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {selectedNode && (
                <div className="space-y-3.5">
                  {/* arXiv ID + Category Badge */}
                  <div
                    className="rounded-xl p-3 flex items-center justify-between"
                    style={{
                      border: "1px solid var(--border-subtle)",
                      backgroundColor: "var(--bg-page)",
                    }}
                  >
                    <div>
                      <p
                        className="text-[10px] font-bold uppercase tracking-widest"
                        style={{ color: "var(--text-accent-dim)" }}
                      >
                        arXiv Identifier
                      </p>
                      <p className="font-mono text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                        {selectedNode.id}
                      </p>
                    </div>
                    <span
                      className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                      style={{
                        backgroundColor: "var(--bg-elevated)",
                        border: "1px solid var(--border-subtle)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {primaryCategory(selectedNode)}
                    </span>
                  </div>

                  {/* Title + Metadata */}
                  <div
                    className="rounded-xl p-3.5"
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
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {selectedNode.categories.slice(0, 6).map((category) => (
                        <span
                          key={`${selectedNode.id}-${category}`}
                          className="rounded-full px-2 py-0.5 text-[11px]"
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

                  {/* Connected Papers in Graph (Non-citation relationships) */}
                  {connectedPapers.length > 0 && (
                    <div
                      className="rounded-xl p-3.5"
                      style={{
                        border: "1px solid var(--border-subtle)",
                        backgroundColor: "var(--bg-page)",
                      }}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <p
                          className="text-[11px] font-bold uppercase tracking-wider"
                          style={{ color: "var(--text-accent-dim)" }}
                        >
                          Connected in Graph ({connectedPapers.length})
                        </p>
                        <span className="text-[10px] italic" style={{ color: "var(--text-muted)" }}>
                          Non-citation
                        </span>
                      </div>
                      <ul className="space-y-1.5 text-xs max-h-44 overflow-y-auto pr-1" aria-label="Connected papers">
                        {connectedPapers.map(({ paper, edgeType, weight }) => (
                          <li
                            key={`${paper.id}-${edgeType}`}
                            className="flex items-center justify-between gap-2 rounded p-1.5 transition-colors hover:bg-[var(--bg-elevated)]"
                          >
                            <button
                              type="button"
                              onClick={() => setSelectedNodeId(paper.id)}
                              className="flex-1 text-left font-medium line-clamp-1 hover:underline transition-colors"
                              style={{ color: "var(--text-primary)" }}
                              title={`Inspect ${paper.title}`}
                            >
                              {paper.title}
                            </button>
                            <span
                              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono font-bold"
                              style={{
                                backgroundColor:
                                  edgeType === "co-author"
                                    ? "var(--cyan-subtle)"
                                    : "var(--bg-elevated)",
                                color:
                                  edgeType === "co-author"
                                    ? "var(--text-accent)"
                                    : "var(--text-secondary)",
                                border: "1px solid var(--border-subtle)",
                              }}
                            >
                              {edgeType === "co-author"
                                ? `${weight} author(s)`
                                : `${weight} field(s)`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Abstract */}
                  <div
                    className="rounded-xl p-3.5"
                    style={{
                      border: "1px solid var(--border-subtle)",
                      backgroundColor: "var(--bg-page)",
                    }}
                  >
                    {detailsLoading && (
                      <div className="flex items-center gap-2 py-2">
                        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                        <p
                          className="text-xs"
                          style={{ color: "var(--text-secondary)" }}
                          aria-live="polite"
                        >
                          Loading abstract…
                        </p>
                      </div>
                    )}
                    {!detailsLoading && detailsError && (
                      <p className="text-xs" style={{ color: "#fda4af" }} role="alert">
                        {detailsError}
                      </p>
                    )}
                    {!detailsLoading && !detailsError && (
                      <>
                        <p
                          className="mb-2 text-[11px] font-bold uppercase tracking-widest"
                          style={{ color: "var(--text-accent-dim)" }}
                        >
                          Abstract
                        </p>
                        <p
                          className="text-xs leading-relaxed max-h-48 overflow-y-auto pr-1"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {selectedDetails?.abstract ?? "Abstract unavailable."}
                        </p>
                      </>
                    )}
                  </div>

                  {/* Actions Bar */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={summarizeSelectedNode}
                      disabled={summaryLoading}
                      className="rounded-lg px-3.5 py-2 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
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

                    <button
                      type="button"
                      onClick={() => toggleCompare(selectedNode.id)}
                      className="rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)]"
                      style={
                        selectedForCompare.includes(selectedNode.id)
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
                      aria-pressed={selectedForCompare.includes(selectedNode.id)}
                      aria-label={
                        selectedForCompare.includes(selectedNode.id)
                          ? `Remove ${selectedNode.title} from comparison`
                          : `Add ${selectedNode.title} to comparison`
                      }
                    >
                      {selectedForCompare.includes(selectedNode.id)
                        ? "✓ In Compare"
                        : "+ Compare"}
                    </button>

                    <a
                      href={
                        selectedDetails?.entry_url ||
                        (selectedNode?.id
                          ? `https://arxiv.org/abs/${selectedNode.id}`
                          : "")
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg px-3 py-2 text-xs font-semibold transition-colors hover:opacity-85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)]"
                      style={{
                        border: "1px solid var(--border-default)",
                        backgroundColor: "var(--bg-elevated)",
                        color: "var(--text-secondary)",
                      }}
                      aria-label={`Open arXiv abstract page for: ${selectedNode.title}`}
                    >
                      arXiv ↗
                    </a>

                    {selectedDetails?.pdf_url && (
                      <a
                        href={selectedDetails.pdf_url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg px-3 py-2 text-xs font-semibold transition-colors hover:opacity-85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)]"
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

                  {/* Summary error with Retry */}
                  {summaryError && (
                    <div
                      className="flex flex-col items-start gap-2 rounded-xl p-3 text-xs"
                      style={{
                        border: "1px solid var(--error-border)",
                        backgroundColor: "var(--error-bg)",
                        color: "#fda4af",
                      }}
                      role="alert"
                    >
                      <p>{summaryError}</p>
                      <button
                        type="button"
                        onClick={summarizeSelectedNode}
                        disabled={summaryLoading}
                        className="rounded-md px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        style={{
                          backgroundColor: "rgba(239,68,68,0.15)",
                          border: "1px solid rgba(239,68,68,0.35)",
                          color: "#fca5a5",
                        }}
                        aria-label={`Retry summary for ${selectedNode?.title || "selected paper"}`}
                      >
                        Retry
                      </button>
                    </div>
                  )}

                  {/* Summary text */}
                  {summaryText && (
                    <div
                      className="rounded-xl p-3.5"
                      style={{
                        border: "1px solid rgba(6,182,212,0.25)",
                        backgroundColor: "var(--bg-page)",
                      }}
                      role="region"
                      aria-label="AI-generated summary"
                    >
                      <div className="mb-1.5 flex items-center justify-between">
                        <p
                          className="text-[11px] font-bold uppercase tracking-widest"
                          style={{ color: "var(--text-accent-dim)" }}
                        >
                          AI Summary
                        </p>
                        <span
                          className="rounded px-1.5 py-0.2 text-[10px]"
                          style={{
                            backgroundColor: "var(--cyan-subtle)",
                            color: "var(--text-accent)",
                          }}
                        >
                          Groq Llama 3.1 8B
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                        {summaryText}
                      </p>
                      <p className="mt-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
                        ⚠ Based on author abstract only — not full paper text.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </aside>
          </div>
        )}

        {/* Node Hover Tooltip */}
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

        {/* Edge Hover Tooltip */}
        {edgeTooltip && (
          <div
            className="pointer-events-none fixed z-50 max-w-80 rounded-xl p-3 text-xs shadow-2xl"
            style={{
              left: Math.min(edgeTooltip.x + 16, window.innerWidth - 330),
              top: edgeTooltip.y + 16,
              border: "1px solid var(--border-default)",
              backgroundColor: "rgba(11,22,40,0.98)",
              color: "var(--text-primary)",
            }}
            role="tooltip"
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <span
                className="inline-block h-2 w-4 rounded-sm"
                style={{
                  backgroundColor:
                    edgeTooltip.edge.type === "co-author"
                      ? EDGE_COLORS["co-author"]
                      : "#64748b",
                }}
              />
              <span className="font-bold text-xs" style={{ color: "var(--text-accent)" }}>
                {edgeTooltip.edge.type === "co-author"
                  ? "Shared Authors Connection"
                  : "Shared Research Field Connection"}
              </span>
            </div>
            <p className="line-clamp-1 font-semibold text-xs" style={{ color: "var(--text-primary)" }}>
              {edgeTooltip.sourceNode.title}
            </p>
            <p className="text-[10px] my-0.5" style={{ color: "var(--text-muted)" }}>
              ↔ linked with ↔
            </p>
            <p className="line-clamp-1 font-semibold text-xs mb-2" style={{ color: "var(--text-primary)" }}>
              {edgeTooltip.targetNode.title}
            </p>
            <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
              {edgeTooltip.edge.type === "co-author"
                ? `These papers share ${edgeTooltip.edge.weight} author(s) in common.`
                : `These papers share ${edgeTooltip.edge.weight} arXiv primary category/categories.`}
            </p>
            <p className="mt-1.5 text-[10px] font-medium" style={{ color: "#fbbf24" }}>
              ⚠ Collaboration / field connection — NOT a citation.
            </p>
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
