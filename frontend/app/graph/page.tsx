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

// Cohesive palette for node categories
const COLOR_PALETTE = [
  "#22d3ee", // cyan
  "#38bdf8", // sky
  "#34d399", // emerald
  "#fbbf24", // amber
  "#a78bfa", // violet
  "#f87171", // rose
  "#2dd4bf", // teal
  "#fb923c", // orange
];

// Edge colors
const EDGE_COLORS = {
  "co-author": "#22d3ee", // cyan — shared author between papers
  "same-field": "#64748b", // slate — shared arXiv category
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
  return date.toLocaleDateString("en-US", {
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

  const showCoAuthorEdgesRef = useRef(showCoAuthorEdges);
  showCoAuthorEdgesRef.current = showCoAuthorEdges;
  const showSameFieldEdgesRef = useRef(showSameFieldEdges);
  showSameFieldEdgesRef.current = showSameFieldEdges;

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
        ? 20 + clampScore(node.relevance_score) * 16
        : 12 + clampScore(node.relevance_score) * 12;
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

    const dx = Math.max(maxX - minX, 100);
    const dy = Math.max(maxY - minY, 100);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const availableWidth = SVG_WIDTH - padding * 2;
    const availableHeight = SVG_HEIGHT - padding * 2;

    const autoScale = Math.min(
      availableWidth / dx,
      availableHeight / dy,
    );
    const clampedScale = Math.min(
      currentNodes.length <= 3 ? 2.2 : currentNodes.length <= 6 ? 1.6 : 1.3,
      Math.max(0.5, autoScale),
    );

    const transform = d3.zoomIdentity
      .translate(SVG_WIDTH / 2, SVG_HEIGHT / 2)
      .scale(clampedScale)
      .translate(-centerX, -centerY);

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const effectiveDuration = prefersReducedMotion ? 0 : duration;

    if (effectiveDuration > 0) {
      d3.select(svgElement)
        .transition()
        .duration(effectiveDuration)
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
    // All edges are bound to simulation links; visibility toggles adjust styles/forces without rebuilding
    const allLinks: SimLink[] = (graphData.edges || []).map((edge) => ({
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

    const radius = (node: SimNode) =>
      isSmallGraph
        ? 20 + clampScore(node.relevance_score) * 16
        : isMediumGraph
        ? 14 + clampScore(node.relevance_score) * 12
        : 10 + clampScore(node.relevance_score) * 10;

    // Background Canvas
    svg
      .append("rect")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("fill", "#040e1b")
      .attr("pointer-events", "none");

    const zoomLayer = svg.append("g").attr("class", "zoom-layer");
    const edgeLayer = zoomLayer.append("g").attr("class", "edges");
    const nodeLayer = zoomLayer.append("g").attr("class", "nodes");
    const labelLayer = zoomLayer.append("g").attr("class", "labels");

    // Edge lines
    const linkSelection = edgeLayer
      .selectAll<SVGLineElement, SimLink>("line")
      .data(allLinks)
      .join("line")
      .style("display", (link) => {
        if (link.type === "co-author" && !showCoAuthorEdgesRef.current) return "none";
        if (link.type === "same-field" && !showSameFieldEdgesRef.current) return "none";
        return null;
      })
      .style("stroke", (link) => EDGE_COLORS[link.type])
      .style("stroke-width", (link) =>
        link.type === "co-author" ? 2 + Math.min(2, link.weight - 1) : 1.5,
      )
      .style("stroke-opacity", (link) =>
        link.type === "co-author" ? 0.8 : 0.45,
      )
      .style("stroke-dasharray", (link) =>
        link.type === "same-field" ? "4 3" : "none",
      )
      .style("cursor", "pointer")
      .on("mouseenter", (event, link) => {
        const sourceNode =
          typeof link.source === "object"
            ? (link.source as SimNode)
            : nodes.find((n) => n.id === link.source);
        const targetNode =
          typeof link.target === "object"
            ? (link.target as SimNode)
            : nodes.find((n) => n.id === link.target);
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
          .style("stroke-width", link.type === "co-author" ? 3.5 : 2.5)
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
            link.type === "co-author" ? 2 + Math.min(2, link.weight - 1) : 1.5,
          )
          .style("stroke-opacity", link.type === "co-author" ? 0.8 : 0.45);
      });

    // Drag behavior
    const dragBehavior = d3
      .drag<SVGCircleElement, SimNode>()
      .on("start", (event, node) => {
        if (!event.active) simulation.alphaTarget(0.25).restart();
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
      .attr("class", "graph-node")
      .attr("r", radius)
      .style("fill", (node) => colorScale(primaryCategory(node)))
      .style("stroke", "#051424")
      .style("stroke-width", 2.5)
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
      .text((node) => truncateLabel(node.title, isSmallGraph ? 42 : 28))
      .style("font-size", isSmallGraph ? "12px" : "11px")
      .style("font-weight", "600")
      .style("font-family", "var(--font-sans)")
      .style("fill", "#f0f5fc")
      .style("pointer-events", "none")
      .style("paint-order", "stroke")
      .style("stroke", "#040e1b")
      .style("stroke-width", "3.5px")
      .style("stroke-linejoin", "round");

    // Dynamic force parameters based on graph size
    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(allLinks)
          .id((node) => node.id)
          .distance(isSmallGraph ? 210 : isMediumGraph ? 160 : 120)
          .strength(0.4),
      )
      .force(
        "charge",
        d3.forceManyBody().strength(isSmallGraph ? -480 : isMediumGraph ? -340 : -250),
      )
      .force("center", d3.forceCenter(SVG_WIDTH / 2, SVG_HEIGHT / 2))
      .force(
        "collision",
        d3.forceCollide<SimNode>().radius((node) => radius(node) + (isSmallGraph ? 24 : 16)),
      )
      .alpha(0.9)
      .alphaDecay(0.035);

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

      if (!hasAutoFittedRef.current && (tickCount >= 25 || simulation.alpha() < 0.12)) {
        hasAutoFittedRef.current = true;
        zoomToFit(70, 300);
      }

      // Settle physics and stop simulation once layout stabilizes (eliminates background CPU usage)
      if (simulation.alpha() < 0.015 || tickCount >= 160) {
        simulation.stop();
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

    return () => {
      simulation.stop();
      simulation.on("tick", null);
      svg.selectAll("*").remove();
      if (simulationRef.current === simulation) simulationRef.current = null;
      zoomBehaviorRef.current = null;
    };
  }, [graphData, zoomToFit]);

  // Update edge visibility and node/edge highlighting without rebuilding SVG or restarting simulation
  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;

    const svg = d3.select(svgElement);

    // 1. Instantly update edge visibility based on active filter toggles
    svg.selectAll<SVGLineElement, SimLink>("g.edges line")
      .style("display", (link) => {
        if (!link) return null;
        if (link.type === "co-author" && !showCoAuthorEdges) return "none";
        if (link.type === "same-field" && !showSameFieldEdges) return "none";
        return null;
      });

    // 2. Highlight selected and hovered nodes in SVG
    const targetId = selectedNodeId || hoveredNodeId;

    if (!targetId) {
      svg.selectAll<SVGCircleElement, SimNode>("g.nodes circle")
        .style("stroke", "#051424")
        .style("stroke-width", 2.5)
        .style("opacity", 1);

      svg.selectAll<SVGLineElement, SimLink>("g.edges line")
        .style("opacity", 1);

      svg.selectAll<SVGTextElement, SimNode>("g.labels text")
        .style("opacity", 1);
      return;
    }

    const connectedNodeIds = new Set<string>([targetId]);
    for (const edge of visibleEdges) {
      if (edge.source === targetId) connectedNodeIds.add(edge.target);
      if (edge.target === targetId) connectedNodeIds.add(edge.source);
    }

    svg.selectAll<SVGCircleElement, SimNode>("g.nodes circle")
      .style("stroke", (node) => (!node ? "#051424" : node.id === targetId ? "#22d3ee" : connectedNodeIds.has(node.id) ? "#38bdf8" : "#051424"))
      .style("stroke-width", (node) => (!node ? 2.5 : node.id === targetId ? 4 : connectedNodeIds.has(node.id) ? 2.5 : 1.5))
      .style("opacity", (node) => (!node || connectedNodeIds.has(node.id) ? 1 : 0.35));

    svg.selectAll<SVGLineElement, SimLink>("g.edges line")
      .style("opacity", (link) => {
        if (!link) return 1;
        const s = typeof link.source === "object" ? (link.source as SimNode)?.id : link.source;
        const t = typeof link.target === "object" ? (link.target as SimNode)?.id : link.target;
        return s === targetId || t === targetId ? 1 : 0.15;
      })
      .style("stroke-width", (link) => {
        if (!link) return 1.5;
        const s = typeof link.source === "object" ? (link.source as SimNode)?.id : link.source;
        const t = typeof link.target === "object" ? (link.target as SimNode)?.id : link.target;
        return s === targetId || t === targetId ? 3 : 1.5;
      });

    svg.selectAll<SVGTextElement, SimNode>("g.labels text")
      .style("opacity", (node) => (!node || connectedNodeIds.has(node.id) ? 1 : 0.35));
  }, [selectedNodeId, hoveredNodeId, visibleEdges, showCoAuthorEdges, showSameFieldEdges]);

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
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      d3.select(svgElement).call(zoomBehavior.scaleBy, factor);
    } else {
      d3.select(svgElement).transition().duration(180).call(zoomBehavior.scaleBy, factor);
    }
  }, []);

  const handleResetLayout = useCallback(() => {
    const simulation = simulationRef.current;
    if (!simulation) return;

    for (const node of simulation.nodes()) {
      node.fx = null;
      node.fy = null;
      node.x = SVG_WIDTH / 2 + (Math.random() - 0.5) * 160;
      node.y = SVG_HEIGHT / 2 + (Math.random() - 0.5) * 160;
      node.vx = 0;
      node.vy = 0;
    }
    simulation.alpha(0.8).restart();

    hasAutoFittedRef.current = false;
    const svgElement = svgRef.current;
    const zoomBehavior = zoomBehaviorRef.current;
    if (svgElement && zoomBehavior) {
      const prefersReducedMotion =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (prefersReducedMotion) {
        d3.select(svgElement).call(zoomBehavior.transform, d3.zoomIdentity);
      } else {
        d3.select(svgElement)
          .transition()
          .duration(180)
          .call(zoomBehavior.transform, d3.zoomIdentity);
      }
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
        } catch {}
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
    <div className="min-h-screen bg-[#051424] text-[#f0f5fc]">
      <Nav selectedIds={selectedForGraph} />

      <main className="page-container py-6 sm:py-8 flex flex-col gap-6">
        {/* Header with Exact Non-Citation Distinction */}
        <header className="rounded-xl border border-[#1d3658] bg-[#0c1a2e] p-5 sm:p-6 shadow-sm flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-xs text-[#9cb3cf]">
                <Link
                  href="/"
                  className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  <span>← Back to Search</span>
                </Link>
                <span className="text-[#607899]">/</span>
                <span className="text-[#9cb3cf]">Relationship Graph</span>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#1d3658] bg-[#11233d] text-cyan-400">
                  <span className="text-sm font-bold" aria-hidden="true">◈</span>
                </div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#f0f5fc]">
                  Research Relationship Graph
                </h1>
                {graphData && graphData.nodes.length > 0 && (
                  <span className="rounded border border-[#1d3658] bg-[#11233d] px-2.5 py-0.5 font-mono text-xs font-semibold text-cyan-400">
                    {graphData.nodes.length} Papers in Graph · {visibleEdges.length} Connections
                  </span>
                )}
              </div>
            </div>

            {/* Top comparison trigger if items are selected */}
            {graphData && graphData.nodes.length >= 2 && (
              <button
                type="button"
                onClick={() => {
                  if (selectedForCompare.length >= 2) {
                    generateComparison();
                  } else {
                    const autoIds = graphData.nodes.slice(0, Math.min(3, graphData.nodes.length)).map((n) => n.id);
                    setSelectedForCompare(autoIds);
                    generateComparison(autoIds);
                  }
                }}
                disabled={isComparing}
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-3.5 py-2 text-xs font-bold text-[#04121e] transition-colors hover:bg-cyan-300 shrink-0 self-start sm:self-center"
              >
                <span>⇄</span>
                <span>
                  {selectedForCompare.length >= 2
                    ? `Open Matrix (${selectedForCompare.length} Selected)`
                    : "Compare Papers"}
                </span>
              </button>
            )}
          </div>

          {/* Context Clarification Banner — Exact Required Non-Citation Wording */}
          <div className="rounded-lg border border-[#1d3658] bg-[#071526] p-3 flex items-start gap-2.5">
            <span className="text-cyan-400 text-sm mt-0.5 shrink-0" aria-hidden="true">ⓘ</span>
            <p className="text-xs text-[#9cb3cf] leading-relaxed">
              Interactive relationship map — edges represent shared authors or shared arXiv categories, <strong className="text-cyan-400 font-semibold">not citation relationships</strong>.
            </p>
          </div>
        </header>

        {/* Empty state — no IDs provided */}
        {requestedIds.length === 0 && (
          <div
            className="rounded-xl border border-dashed border-[#1d3658] bg-[#0c1a2e]/50 p-10 text-center"
            role="status"
          >
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-[#1d3658] bg-[#11233d] text-2xl text-cyan-400">
              ◈
            </div>
            <p className="text-base font-bold text-[#f0f5fc]">
              No papers selected
            </p>
            <p className="mt-1.5 text-xs sm:text-sm text-[#9cb3cf]">
              Go back to search, select papers using{" "}
              <strong className="text-cyan-400 font-semibold">Add to Graph</strong>,
              then open this page.
            </p>
            <Link
              href="/"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-cyan-400 px-4 py-2 text-xs font-bold text-[#04121e] transition-colors hover:bg-cyan-300"
            >
              <span>← Go to Search</span>
            </Link>
          </div>
        )}

        {/* Active comparison view */}
        {showComparisonView && (
          <ComparisonMatrix
            isComparing={isComparing}
            comparisonError={comparisonError}
            comparisonResult={comparisonResult}
            onClose={() => setShowComparisonView(false)}
            onRetry={() => generateComparison()}
          />
        )}

        {/* Graph + Sidebar Two-Column Workspace */}
        {requestedIds.length > 0 && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
            {/* Main Graph Workspace (8 cols on lg/xl) */}
            <section
              className="lg:col-span-8 flex flex-col gap-3 rounded-xl border border-[#1d3658] bg-[#0c1a2e] p-4 sm:p-5 shadow-sm"
              aria-label="Research relationship graph"
            >
              {/* Toolbar Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-[#1d3658] bg-[#071526] p-2">
                {/* Zoom / layout toolbar */}
                <div className="flex items-center gap-1.5" role="toolbar" aria-label="Graph controls">
                  <button
                    type="button"
                    onClick={() => handleZoomBy(1.25)}
                    className="flex h-7 w-7 items-center justify-center rounded border border-[#1d3658] bg-[#11233d] text-xs font-bold text-[#f0f5fc] transition-colors hover:border-cyan-500/40 hover:text-cyan-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
                    aria-label="Zoom in"
                    title="Zoom in"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => handleZoomBy(0.8)}
                    className="flex h-7 w-7 items-center justify-center rounded border border-[#1d3658] bg-[#11233d] text-xs font-bold text-[#f0f5fc] transition-colors hover:border-cyan-500/40 hover:text-cyan-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
                    aria-label="Zoom out"
                    title="Zoom out"
                  >
                    −
                  </button>
                  <div className="h-4 w-px bg-[#1d3658] mx-0.5" />
                  <button
                    type="button"
                    onClick={() => zoomToFit(70, 300)}
                    className="rounded border border-[#1d3658] bg-[#11233d] px-2.5 h-7 text-xs font-medium text-[#9cb3cf] transition-colors hover:border-cyan-500/40 hover:text-[#f0f5fc] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
                    aria-label="Fit graph to view"
                    title="Center and fit all nodes in view"
                  >
                    Fit View
                  </button>
                  <button
                    type="button"
                    onClick={handleResetLayout}
                    className="rounded border border-cyan-400/40 bg-cyan-400/15 px-2.5 h-7 text-xs font-bold text-cyan-300 transition-colors hover:bg-cyan-400/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
                    aria-label="Reset graph layout"
                    title="Re-run simulation physics"
                  >
                    Reset
                  </button>
                </div>

                {/* Edge Filters */}
                <div
                  className="flex items-center gap-2 flex-wrap"
                  role="group"
                  aria-label="Edge relationship filters"
                >
                  <label
                    className={`flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      showCoAuthorEdges
                        ? "border border-cyan-500/40 bg-cyan-500/15 text-cyan-300"
                        : "border border-[#1d3658] bg-[#11233d] text-[#607899]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={showCoAuthorEdges}
                      onChange={(event) => setShowCoAuthorEdges(event.target.checked)}
                      className="accent-cyan-400"
                      aria-label="Show co-author edges (shared authors between papers)"
                    />
                    <span
                      className="inline-block h-1.5 w-3 rounded-full bg-cyan-400"
                      aria-hidden="true"
                    />
                    <span>Co-author ({coAuthorEdgeCount})</span>
                  </label>

                  <label
                    className={`flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      showSameFieldEdges
                        ? "border border-[#1d3658] bg-[#11233d] text-[#f0f5fc]"
                        : "border border-[#1d3658]/60 bg-[#11233d]/40 text-[#607899]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={showSameFieldEdges}
                      onChange={(event) => setShowSameFieldEdges(event.target.checked)}
                      className="accent-cyan-400"
                      aria-label="Show same-field edges (shared arXiv categories between papers)"
                    />
                    <span
                      className="inline-block h-0 w-3 border-b-2 border-dashed border-[#64748b]"
                      aria-hidden="true"
                    />
                    <span>Same field ({sameFieldEdgeCount})</span>
                  </label>
                </div>
              </div>

              {/* Accessible Node Selector Dropdown (Keyboard & Screen Reader accessibility) */}
              {graphData && graphData.nodes.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#1d3658] bg-[#071526] px-3 py-1.5 text-xs">
                  <span className="font-mono text-xs font-semibold text-cyan-400 shrink-0">
                    Keyboard Node Selector:
                  </span>
                  <div className="flex flex-1 min-w-[200px] items-center gap-2">
                    <label htmlFor="accessible-node-select" className="sr-only">
                      Select paper in graph
                    </label>
                    <select
                      id="accessible-node-select"
                      value={selectedNodeId || ""}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSelectedNodeId(id || null);
                        if (id && window.innerWidth < 1024) {
                          detailsAsideRef.current?.scrollIntoView?.({ behavior: "smooth" });
                        }
                      }}
                      className="h-7 w-full rounded border border-[#1d3658] bg-[#0c1a2e] px-2 text-xs text-[#f0f5fc] transition-colors focus:border-cyan-400 focus:outline-none"
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

              {/* Compare Matrix Shortcut Bar */}
              {graphData && graphData.nodes.length >= 2 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#1d3658] bg-[#071526] px-3 py-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-[#9cb3cf]">
                      Compare:
                    </span>
                    <span
                      className={`rounded px-2 py-0.2 font-mono text-[11px] font-semibold border ${
                        selectedForCompare.length >= 2
                          ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-300"
                          : "border-[#1d3658] bg-[#11233d] text-[#607899]"
                      }`}
                    >
                      {selectedForCompare.length} / 4 selected
                    </span>
                    {selectedForCompare.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedForCompare([])}
                        className="text-[#607899] hover:text-[#f0f5fc] hover:underline"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {selectedForCompare.length >= 2 ? (
                      <button
                        type="button"
                        onClick={() => generateComparison()}
                        disabled={isComparing}
                        className="rounded bg-cyan-400 px-3 py-1 text-xs font-bold text-[#04121e] transition-colors hover:bg-cyan-300 disabled:opacity-50"
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
                        className="rounded border border-[#1d3658] bg-[#11233d] px-3 py-1 text-xs font-medium text-[#9cb3cf] transition-colors hover:border-[#2b4f7c] hover:text-[#f0f5fc]"
                      >
                        Compare Top {Math.min(3, graphData.nodes.length)}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Loading State */}
              {isLoadingGraph && (
                <div
                  className="flex h-[480px] items-center justify-center rounded-lg border border-[#1d3658] bg-[#071526]"
                  role="status"
                  aria-live="polite"
                >
                  <div className="text-center p-6">
                    <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                    <p className="mt-3 text-xs sm:text-sm font-semibold text-[#f0f5fc]">
                      Building relationship graph from arXiv metadata…
                    </p>
                  </div>
                </div>
              )}

              {/* Error State */}
              {!isLoadingGraph && graphError && (
                <div
                  className="flex h-[480px] flex-col items-center justify-center rounded-lg border border-rose-500/40 bg-rose-500/10 p-6 text-center"
                  role="alert"
                >
                  <p className="text-xs sm:text-sm font-semibold text-rose-300">{graphError}</p>
                </div>
              )}

              {/* Empty Graph Nodes */}
              {!isLoadingGraph && !graphError && graphData && graphData.nodes.length === 0 && (
                <div
                  className="flex h-[480px] items-center justify-center rounded-lg border border-[#1d3658] bg-[#071526] p-6 text-center"
                  role="status"
                >
                  <p className="text-sm font-medium text-[#9cb3cf]">
                    No nodes returned for selected IDs.
                  </p>
                </div>
              )}

              {/* SVG Canvas */}
              {!isLoadingGraph && !graphError && graphData && graphData.nodes.length > 0 && (
                <div className="flex flex-col gap-2.5">
                  <div className="relative overflow-hidden rounded-lg border border-[#1d3658] bg-[#040e1b]">
                    <svg
                      ref={svgRef}
                      viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                      className="w-full cursor-grab active:cursor-grabbing select-none"
                      style={{
                        height: "clamp(440px, 62vh, 640px)",
                      }}
                      role="img"
                      aria-label={`Research relationship graph with ${graphData.nodes.length} papers`}
                    />

                    {/* Canvas Instruction */}
                    <div className="pointer-events-none absolute bottom-2.5 right-2.5 hidden sm:flex items-center rounded border border-[#1d3658] bg-[#0c1a2e]/90 px-2 py-0.5 text-[11px] text-[#607899] backdrop-blur-sm">
                      <span>Click node to inspect · Drag to pan</span>
                    </div>
                  </div>

                  {/* Category Color Legend */}
                  {categoryColorMap.size > 0 && (
                    <div
                      className="flex flex-wrap items-center gap-1.5 text-xs"
                      aria-label="Node color legend by category"
                    >
                      <span className="font-mono text-xs font-medium text-[#607899] mr-1">
                        Categories:
                      </span>
                      {Array.from(categoryColorMap.entries()).map(([cat, color]) => {
                        const count = graphData.nodes.filter((n) => primaryCategory(n) === cat).length;
                        return (
                          <div
                            key={cat}
                            className="flex items-center gap-1.5 rounded border border-[#1d3658] bg-[#071526] px-2 py-0.5"
                          >
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ backgroundColor: color }}
                              aria-hidden="true"
                            />
                            <span className="font-mono text-[#9cb3cf] text-xs font-medium">{cat}</span>
                            <span className="rounded bg-[#11233d] px-1.5 py-0.5 text-xs font-mono text-[#829ab8]">
                              {count}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Edge Relationship Legend Bar with Required Exact Text */}
                  <div
                    className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-[#1d3658] bg-[#071526] p-2.5 text-xs text-[#9cb3cf]"
                    aria-label="Edge type legend"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-1.5 w-3.5 rounded-full bg-cyan-400"
                          aria-hidden="true"
                        />
                        <span><strong className="text-[#f0f5fc]">Solid cyan:</strong> Shared author(s)</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-0 w-3.5 border-b-2 border-dashed border-[#64748b]"
                          aria-hidden="true"
                        />
                        <span><strong className="text-[#f0f5fc]">Dashed grey:</strong> Shared arXiv field</span>
                      </span>
                    </div>
                    <span className="text-xs text-[#9cb3cf]">
                      Relationships show collaboration &amp; field similarity — NOT citations
                    </span>
                  </div>
                </div>
              )}
            </section>

            {/* Details Sidebar (4 cols on lg/xl) */}
            <aside
              ref={detailsAsideRef}
              className="lg:col-span-4 rounded-xl border border-[#1d3658] bg-[#0c1a2e] p-5 shadow-sm flex flex-col gap-3.5 lg:sticky lg:top-20 max-h-[calc(100vh-6rem)] overflow-y-auto scroll-mt-24"
              aria-label="Selected paper details"
            >
              <div className="flex items-center justify-between border-b border-[#1d3658] pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-cyan-400 text-xs font-bold" aria-hidden="true">📄</span>
                  <h2 className="text-sm font-bold text-[#f0f5fc]">
                    Paper Details
                  </h2>
                </div>
                {selectedNode && (
                  <button
                    type="button"
                    onClick={() => setSelectedNodeId(null)}
                    className="rounded border border-[#1d3658] bg-[#11233d] px-2 py-0.5 text-xs text-[#9cb3cf] hover:text-[#f0f5fc]"
                    aria-label="Deselect paper"
                  >
                    ✕ Close
                  </button>
                )}
              </div>

              {/* State when NO paper is selected */}
              {!selectedNode && (
                <div className="space-y-3">
                  <p className="text-xs text-[#9cb3cf] leading-relaxed">
                    Click any node in the graph, select from the dropdown above, or choose a paper from the list below to inspect its abstract, connections, and AI summary.
                  </p>

                  {graphData && graphData.nodes.length > 0 && (
                    <div className="rounded-lg border border-[#1d3658] bg-[#071526] p-3">
                      <span className="font-mono text-xs font-semibold text-cyan-400 block mb-2">
                        Papers in Graph ({graphData.nodes.length})
                      </span>
                      <ul className="space-y-1 overflow-y-auto max-h-[340px] pr-1">
                        {graphData.nodes.map((node) => (
                          <li key={node.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedNodeId(node.id);
                                if (window.innerWidth < 1024) {
                                  detailsAsideRef.current?.scrollIntoView?.({ behavior: "smooth" });
                                }
                              }}
                              className="w-full text-left rounded p-2 text-xs transition-colors hover:bg-[#11233d] flex flex-col gap-0.5 border border-transparent hover:border-[#1d3658]"
                            >
                              <span className="font-medium text-[#f0f5fc] line-clamp-1">
                                {node.title}
                              </span>
                              <div className="flex items-center justify-between font-mono text-xs text-[#829ab8]">
                                <span>arXiv:{node.id}</span>
                                <span className="text-cyan-400">{primaryCategory(node)}</span>
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* State when a paper IS selected */}
              {selectedNode && (
                <div className="space-y-3.5">
                  {/* Category & arXiv Badges */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1 font-mono text-xs">
                      <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-medium text-cyan-400">
                        arXiv:{selectedNode.id}
                      </span>
                      <span className="rounded border border-[#1d3658] bg-[#11233d] px-1.5 py-0.5 text-[#9cb3cf]">
                        [{primaryCategory(selectedNode)}]
                      </span>
                    </div>

                    <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-xs font-semibold text-emerald-400">
                      {Math.round(selectedNode.relevance_score * 100)}% Sim
                    </span>
                  </div>

                  {/* Title & Authors */}
                  <div className="rounded-lg border border-[#1d3658] bg-[#071526] p-3.5">
                    <h3 className="text-sm font-semibold leading-snug text-[#f0f5fc]">
                      {selectedNode.title}
                    </h3>
                    <p className="mt-1.5 text-xs text-[#9cb3cf] line-clamp-2">
                      {selectedNode.authors.join(", ") || "Unknown authors"}
                    </p>
                    <p className="mt-1 text-xs text-[#829ab8]">
                      Published: {formatDate(selectedNode.published)}
                    </p>
                  </div>

                  {/* External Links */}
                  <div className="grid grid-cols-2 gap-2">
                    <a
                      href={
                        selectedDetails?.entry_url ||
                        `https://arxiv.org/abs/${selectedNode.id}`
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-[#1d3658] bg-[#11233d] py-1.5 px-3 text-xs font-medium text-[#f0f5fc] transition-colors hover:border-cyan-500/40 hover:text-cyan-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
                      aria-label={`Open arXiv abstract page for: ${selectedNode.title}`}
                    >
                      <span>arXiv ↗</span>
                    </a>

                    <a
                      href={
                        selectedDetails?.pdf_url ||
                        `https://arxiv.org/pdf/${selectedNode.id}`
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center gap-1 rounded-lg bg-cyan-400/15 border border-cyan-400/40 py-1.5 px-3 text-xs font-bold text-cyan-300 transition-colors hover:bg-cyan-400/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
                      aria-label={`Open PDF for: ${selectedNode.title}`}
                    >
                      <span>View PDF ↗</span>
                    </a>
                  </div>

                  {/* Actions: Compare & Summarize */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleCompare(selectedNode.id)}
                      className={`flex-1 inline-flex items-center justify-center gap-1 rounded-lg py-1.5 px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
                        selectedForCompare.includes(selectedNode.id)
                          ? "border border-cyan-400/50 bg-cyan-500/20 text-cyan-300"
                          : "border border-[#1d3658] bg-[#071526] text-[#9cb3cf] hover:border-[#2b4f7c] hover:text-[#f0f5fc]"
                      }`}
                      aria-pressed={selectedForCompare.includes(selectedNode.id)}
                      aria-label={
                        selectedForCompare.includes(selectedNode.id)
                          ? `Remove ${selectedNode.title} from comparison`
                          : `Add ${selectedNode.title} to comparison`
                      }
                    >
                      <span>{selectedForCompare.includes(selectedNode.id) ? "✓ In Compare" : "+ Compare"}</span>
                    </button>

                    <button
                      type="button"
                      onClick={summarizeSelectedNode}
                      disabled={summaryLoading}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-cyan-400 py-1.5 px-3 text-xs font-bold text-[#04121e] transition-colors hover:bg-cyan-300 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                      aria-label={
                        summaryLoading
                          ? "Generating summary…"
                          : `Summarize: ${selectedNode.title}`
                      }
                    >
                      {summaryLoading ? (
                        <>
                          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#04121e] border-t-transparent" />
                          <span>Summarizing…</span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden="true">✦</span>
                          <span>Summarize</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Connected Papers (Non-citation relationships) */}
                  {connectedPapers.length > 0 && (
                    <div className="rounded-lg border border-[#1d3658] bg-[#071526] p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-mono text-xs font-semibold text-cyan-400">
                          Connected in Graph ({connectedPapers.length})
                        </span>
                        <span className="text-xs text-[#829ab8] italic">
                          Non-citation
                        </span>
                      </div>
                      <ul className="space-y-1.5 text-xs max-h-40 overflow-y-auto pr-1" aria-label="Connected papers">
                        {connectedPapers.map(({ paper, edgeType, weight }) => (
                          <li
                            key={`${paper.id}-${edgeType}`}
                            className="flex items-center justify-between gap-2 rounded border border-[#1d3658]/60 bg-[#0c1a2e] p-2 transition-colors hover:border-[#2b4f7c]"
                          >
                            <button
                              type="button"
                              onClick={() => setSelectedNodeId(paper.id)}
                              className="flex-1 text-left font-medium text-[#f0f5fc] line-clamp-1 hover:text-cyan-300 hover:underline transition-colors"
                              title={`Inspect ${paper.title}`}
                            >
                              {paper.title}
                            </button>
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${
                                edgeType === "co-author"
                                  ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                                  : "bg-[#11233d] text-[#9cb3cf] border border-[#1d3658]"
                              }`}
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

                  {/* Abstract Section */}
                  <div className="rounded-lg border border-[#1d3658] bg-[#071526] p-3">
                    {detailsLoading && (
                      <div className="flex items-center gap-2 py-1 text-xs text-cyan-400">
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                        <p aria-live="polite">Loading abstract…</p>
                      </div>
                    )}

                    {!detailsLoading && detailsError && (
                      <p className="text-xs text-rose-300" role="alert">
                        {detailsError}
                      </p>
                    )}

                    {!detailsLoading && !detailsError && (
                      <>
                        <span className="mb-1.5 block font-mono text-xs font-semibold text-cyan-400">
                          Abstract
                        </span>
                        <p className="text-xs sm:text-sm text-[#9cb3cf] leading-relaxed max-h-44 overflow-y-auto pr-1">
                          {selectedDetails?.abstract ?? "Abstract unavailable."}
                        </p>
                      </>
                    )}
                  </div>

                  {/* Summary error with retry */}
                  {summaryError && (
                    <div
                      className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300 flex flex-col gap-2"
                      role="alert"
                    >
                      <p>{summaryError}</p>
                      <button
                        type="button"
                        onClick={summarizeSelectedNode}
                        disabled={summaryLoading}
                        className="rounded bg-rose-700 hover:bg-rose-600 px-3 py-1 text-xs font-bold text-white self-start transition-colors"
                        aria-label={`Retry summary for ${selectedNode?.title || "selected paper"}`}
                      >
                        Retry
                      </button>
                    </div>
                  )}

                  {/* Generated AI Summary */}
                  {summaryText && (
                    <div
                      className="rounded-lg border border-cyan-500/30 bg-[#071526] p-3.5 space-y-1.5"
                      role="region"
                      aria-label="AI-generated summary"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-semibold text-cyan-400">
                          AI Summary
                        </span>
                        <span className="rounded border border-[#1d3658] bg-[#11233d] px-1.5 py-0.5 font-mono text-xs text-[#9cb3cf]">
                          Groq Llama 3.1 8B
                        </span>
                      </div>
                      <p className="text-xs sm:text-sm text-[#f0f5fc] leading-relaxed">
                        {summaryText}
                      </p>
                      <p className="text-xs text-[#829ab8]">
                        ⚠ Grounded on title &amp; abstract only — not full paper text.
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
            className="pointer-events-none fixed z-50 max-w-72 rounded-lg border border-[#1d3658] bg-[#0c1a2e]/98 p-3 text-xs text-[#f0f5fc] shadow-xl backdrop-blur-sm"
            style={{
              left: Math.min(tooltip.x + 16, window.innerWidth - 300),
              top: tooltip.y + 16,
            }}
            role="tooltip"
          >
            <p className="mb-1 line-clamp-2 text-xs font-bold text-cyan-400 leading-snug">
              {tooltip.node.title}
            </p>
            <p className="text-[#9cb3cf] text-[11px]">
              {tooltip.node.authors.slice(0, 3).join(", ") || "Unknown authors"}
            </p>
            <p className="mt-1 text-[10px] text-[#607899]">
              {formatDate(tooltip.node.published)}
            </p>
            {tooltip.node.categories.length > 0 && (
              <p className="mt-1 font-mono text-[10px] text-cyan-300">
                {tooltip.node.categories.slice(0, 3).join(", ")}
              </p>
            )}
          </div>
        )}

        {/* Edge Hover Tooltip */}
        {edgeTooltip && (
          <div
            className="pointer-events-none fixed z-50 max-w-80 rounded-lg border border-[#1d3658] bg-[#0c1a2e]/98 p-3 text-xs text-[#f0f5fc] shadow-xl backdrop-blur-sm"
            style={{
              left: Math.min(edgeTooltip.x + 16, window.innerWidth - 330),
              top: edgeTooltip.y + 16,
            }}
            role="tooltip"
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span
                className="inline-block h-2 w-3 rounded-sm"
                style={{
                  backgroundColor:
                    edgeTooltip.edge.type === "co-author"
                      ? EDGE_COLORS["co-author"]
                      : "#64748b",
                }}
              />
              <span className="font-bold text-xs text-cyan-400">
                {edgeTooltip.edge.type === "co-author"
                  ? "Shared Authors Connection"
                  : "Shared Research Field Connection"}
              </span>
            </div>
            <p className="line-clamp-1 font-semibold text-xs text-[#f0f5fc]">
              {edgeTooltip.sourceNode.title}
            </p>
            <p className="text-[10px] my-0.5 text-[#607899]">
              ↔ linked with ↔
            </p>
            <p className="line-clamp-1 font-semibold text-xs mb-1.5 text-[#f0f5fc]">
              {edgeTooltip.targetNode.title}
            </p>
            <p className="text-[11px] text-[#9cb3cf]">
              {edgeTooltip.edge.type === "co-author"
                ? `These papers share ${edgeTooltip.edge.weight} author(s) in common.`
                : `These papers share ${edgeTooltip.edge.weight} arXiv primary category/categories.`}
            </p>
            <p className="mt-1 text-[10px] font-medium text-amber-400">
              ⚠ Collaboration / field connection — NOT a citation.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Suspense wrapper ─────────────────────────────────────────────────────────

function GraphPageFallback() {
  return (
    <div className="min-h-screen bg-[#051424] text-[#f0f5fc]">
      <div className="page-container py-12 flex items-center justify-center">
        <div
          className="flex h-64 w-full max-w-md flex-col items-center justify-center rounded-xl border border-[#1d3658] bg-[#0c1a2e]"
          role="status"
          aria-live="polite"
        >
          <span className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          <p className="mt-3 text-xs sm:text-sm font-semibold text-[#9cb3cf]">
            Loading research graph…
          </p>
        </div>
      </div>
    </div>
  );
}

export default function GraphPage() {
  return (
    <Suspense fallback={<GraphPageFallback />}>
      <GraphPageContent />
    </Suspense>
  );
}
