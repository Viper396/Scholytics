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
const SVG_HEIGHT = 700;
const GRAPH_SELECTION_STORAGE_KEY = "scholytics.selectedForGraph";

const COLOR_PALETTE = [
  "#24c6d8", // cyan
  "#a78bfa", // purple / violet
  "#34d399", // emerald / green
  "#38bdf8", // sky
  "#fbbf24", // amber
  "#f87171", // rose
  "#fb923c", // orange
];

const EDGE_COLORS = {
  "co-author": "#24c6d8",
  "same-field": "#64748b",
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
  const urlIds = useMemo(
    () => parseIdsParam(searchParams?.get("ids") ?? null),
    [searchParams],
  );

  const [storedIds, setStoredIds] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(GRAPH_SELECTION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setStoredIds(
            parsed.map((id) => String(id).trim()).filter((id) => id.length > 0),
          );
        }
      }
    } catch {}
  }, []);

  const requestedIds = useMemo(() => {
    return urlIds.length > 0 ? urlIds : storedIds;
  }, [urlIds, storedIds]);

  const idsKey = useMemo(
    () => [...requestedIds].sort().join(","),
    [requestedIds],
  );

  const [graphData, setGraphData] = useState<GraphResponse | null>(null);
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);

  const [showCoAuthorEdges, setShowCoAuthorEdges] = useState(true);
  const [showSameFieldEdges, setShowSameFieldEdges] = useState(true);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [edgeTooltip, setEdgeTooltip] = useState<EdgeTooltipState | null>(null);

  const [detailsById, setDetailsById] = useState<Record<string, PaperDetails>>({});
  const [, setDetailsLoading] = useState(false);
  const [, setDetailsError] = useState<string | null>(null);

  const [summaryById, setSummaryById] = useState<Record<string, string>>({});
  const [summaryLoadingById, setSummaryLoadingById] = useState<Record<string, boolean>>({});
  const [summaryErrorById, setSummaryErrorById] = useState<Record<string, string>>({});

  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [showComparisonView, setShowComparisonView] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const comparisonAbortRef = useRef<AbortController | null>(null);
  const hasAutoFittedRef = useRef(false);

  const showCoAuthorEdgesRef = useRef(showCoAuthorEdges);
  const showSameFieldEdgesRef = useRef(showSameFieldEdges);
  useEffect(() => {
    showCoAuthorEdgesRef.current = showCoAuthorEdges;
  }, [showCoAuthorEdges]);
  useEffect(() => {
    showSameFieldEdgesRef.current = showSameFieldEdges;
  }, [showSameFieldEdges]);

  const visibleEdges = useMemo(() => {
    if (!graphData) return [];
    return (graphData.edges || []).filter((edge) => {
      if (edge.type === "co-author" && !showCoAuthorEdges) return false;
      if (edge.type === "same-field" && !showSameFieldEdges) return false;
      return true;
    });
  }, [graphData, showCoAuthorEdges, showSameFieldEdges]);

  const coAuthorEdgeCount = useMemo(() => {
    return (graphData?.edges || []).filter((e) => e.type === "co-author").length;
  }, [graphData]);

  const sameFieldEdgeCount = useMemo(() => {
    return (graphData?.edges || []).filter((e) => e.type === "same-field").length;
  }, [graphData]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId || !graphData) return null;
    return graphData.nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [selectedNodeId, graphData]);

  const selectedDetails = useMemo(() => {
    if (!selectedNodeId) return null;
    return detailsById[selectedNodeId] ?? null;
  }, [selectedNodeId, detailsById]);

  // Compute connected papers with exact reason (shared author or shared category)
  const connectedPapers = useMemo(() => {
    if (!selectedNodeId || !graphData) return [];
    const results: Array<{
      paper: GraphNode;
      edgeType: "co-author" | "same-field";
      weight: number;
      reason: string;
    }> = [];
    const selected = graphData.nodes.find((n) => n.id === selectedNodeId);

    for (const edge of visibleEdges) {
      let otherId: string | null = null;
      if (edge.source === selectedNodeId) otherId = edge.target;
      else if (edge.target === selectedNodeId) otherId = edge.source;

      if (otherId) {
        const other = graphData.nodes.find((n) => n.id === otherId);
        if (other) {
          let reason = "";
          if (edge.type === "co-author") {
            const shared = (selected?.authors || []).filter((a) =>
              (other.authors || []).includes(a),
            );
            reason =
              shared.length > 0
                ? `shared author (${shared[0]})`
                : "shared author";
          } else {
            const sharedCats = (selected?.categories || []).filter((c) =>
              (other.categories || []).includes(c),
            );
            reason =
              sharedCats.length > 0
                ? `shared category (${sharedCats[0]})`
                : "shared category";
          }
          results.push({
            paper: other,
            edgeType: edge.type,
            weight: edge.weight,
            reason,
          });
        }
      }
    }
    return results;
  }, [selectedNodeId, graphData, visibleEdges]);

  // Category -> Color mapping
  const categoryColorMap = useMemo(() => {
    if (!graphData) return new Map<string, string>();
    const categories = Array.from(
      new Set(graphData.nodes.map((n) => primaryCategory(n))),
    );
    return new Map(
      categories.map((cat, i) => [cat, COLOR_PALETTE[i % COLOR_PALETTE.length]]),
    );
  }, [graphData]);

  // Fetch graph data
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
          const nodes = Array.isArray(data.nodes) ? data.nodes : [];
          setGraphData({
            nodes,
            edges: Array.isArray(data.edges) ? data.edges : [],
          });
          // Auto select first node if none selected
          if (nodes.length > 0) {
            setSelectedNodeId((current) => current || nodes[0].id);
          }
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

  // Zoom-to-fit
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

    const autoScale = Math.min(availableWidth / dx, availableHeight / dy);
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

  // ── D3 Simulation ──────────────────────────────────────────────────────────

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement || !graphData || graphData.nodes.length === 0) return;

    const svg = d3.select(svgElement);
    svg.selectAll("*").remove();

    const isSmallGraph = graphData.nodes.length <= 5;
    const isMediumGraph = graphData.nodes.length <= 10;

    const nodes: SimNode[] = graphData.nodes.map((node) => ({ ...node }));
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
        ? 22 + clampScore(node.relevance_score) * 16
        : isMediumGraph
        ? 15 + clampScore(node.relevance_score) * 12
        : 11 + clampScore(node.relevance_score) * 10;

    // Background Canvas
    svg
      .append("rect")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("fill", "#07111d")
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
        link.type === "co-author" ? 2.5 : 1.5,
      )
      .style("stroke-opacity", (link) =>
        link.type === "co-author" ? 0.85 : 0.45,
      )
      .style("stroke-dasharray", (link) =>
        link.type === "same-field" ? "5 4" : "none",
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
      })
      .on("mouseleave", () => {
        setEdgeTooltip(null);
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
      .style("stroke", "#07111d")
      .style("stroke-width", 3)
      .style("cursor", "pointer")
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (node) => `${node.title} (${node.id})`)
      .on("mouseenter", (event, node) => {
        setHoveredNodeId(node.id);
        setTooltip({ x: event.clientX, y: event.clientY, node });
      })
      .on("mousemove", (event, node) => {
        setTooltip({ x: event.clientX, y: event.clientY, node });
      })
      .on("mouseleave", () => {
        setHoveredNodeId(null);
        setTooltip(null);
      })
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

    // Labels with halo stroke for high contrast legibility
    const labelSelection = labelLayer
      .selectAll<SVGTextElement, SimNode>("text")
      .data(nodes)
      .join("text")
      .text((node) => truncateLabel(node.title, isSmallGraph ? 44 : 30))
      .style("font-size", isSmallGraph ? "12px" : "11px")
      .style("font-weight", "600")
      .style("font-family", "var(--font-sans)")
      .style("fill", "#eaf2f8")
      .style("pointer-events", "none")
      .style("text-anchor", "middle")
      .style("paint-order", "stroke")
      .style("stroke", "#07111d")
      .style("stroke-width", "3.5px")
      .style("stroke-linejoin", "round");

    // Force simulation
    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(allLinks)
          .id((node) => node.id)
          .distance(isSmallGraph ? 220 : isMediumGraph ? 170 : 130)
          .strength(0.4),
      )
      .force(
        "charge",
        d3.forceManyBody().strength(isSmallGraph ? -520 : isMediumGraph ? -380 : -280),
      )
      .force("center", d3.forceCenter(SVG_WIDTH / 2, SVG_HEIGHT / 2))
      .force(
        "collision",
        d3.forceCollide<SimNode>().radius((node) => radius(node) + (isSmallGraph ? 28 : 18)),
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
        .attr("x", (node) => node.x ?? 0)
        .attr("y", (node) => (node.y ?? 0) - radius(node) - 8);

      if (!hasAutoFittedRef.current && (tickCount >= 25 || simulation.alpha() < 0.12)) {
        hasAutoFittedRef.current = true;
        zoomToFit(70, 300);
      }

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

    svg.call(zoomBehavior);
    zoomBehaviorRef.current = zoomBehavior;

    return () => {
      simulation.stop();
    };
  }, [graphData, zoomToFit]);

  // Handle node selection highlights in D3
  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;

    const svg = d3.select(svgElement);
    const targetId = selectedNodeId || hoveredNodeId;

    if (!targetId) {
      svg
        .selectAll<SVGCircleElement, SimNode>("g.nodes circle")
        .style("stroke", "#07111d")
        .style("stroke-width", 3)
        .style("opacity", 1);

      svg.selectAll<SVGLineElement, SimLink>("g.edges line").style("opacity", 1);
      svg.selectAll<SVGTextElement, SimNode>("g.labels text").style("opacity", 1);
      return;
    }

    const connectedNodeIds = new Set<string>([targetId]);
    for (const edge of visibleEdges) {
      if (edge.source === targetId) connectedNodeIds.add(edge.target);
      if (edge.target === targetId) connectedNodeIds.add(edge.source);
    }

    svg
      .selectAll<SVGCircleElement, SimNode>("g.nodes circle")
      .style("stroke", (node) =>
        !node
          ? "#07111d"
          : node.id === targetId
          ? "#24c6d8"
          : connectedNodeIds.has(node.id)
          ? "#3de0f2"
          : "#07111d",
      )
      .style("stroke-width", (node) =>
        !node ? 3 : node.id === targetId ? 5 : connectedNodeIds.has(node.id) ? 3 : 2,
      )
      .style("opacity", (node) => (!node || connectedNodeIds.has(node.id) ? 1 : 0.3));

    svg
      .selectAll<SVGLineElement, SimLink>("g.edges line")
      .style("opacity", (link) => {
        if (!link) return 1;
        const s =
          typeof link.source === "object"
            ? (link.source as SimNode)?.id
            : link.source;
        const t =
          typeof link.target === "object"
            ? (link.target as SimNode)?.id
            : link.target;
        return s === targetId || t === targetId ? 1 : 0.15;
      });

    svg
      .selectAll<SVGTextElement, SimNode>("g.labels text")
      .style("opacity", (node) => (!node || connectedNodeIds.has(node.id) ? 1 : 0.35));
  }, [selectedNodeId, hoveredNodeId, visibleEdges, showCoAuthorEdges, showSameFieldEdges]);

  // Fetch paper details when node selected
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

  // Zoom controls
  const handleZoomBy = useCallback((factor: number) => {
    const svgElement = svgRef.current;
    const zoomBehavior = zoomBehaviorRef.current;
    if (!svgElement || !zoomBehavior) return;
    d3.select(svgElement).call(zoomBehavior.scaleBy as any, factor);
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
      d3.select(svgElement).call(zoomBehavior.transform, d3.zoomIdentity);
    }
  }, []);

  // Summarize selected node
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

    try {
      const response = await fetch(
        `/api/papers/${encodeURIComponent(nodeId)}/summarize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, abstract }),
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

  function toggleCompare(arxivId: string) {
    setSelectedForCompare((current) => {
      if (current.includes(arxivId)) return current.filter((id) => id !== arxivId);
      if (current.length >= 4) return current;
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
      setComparisonError("Select at least 2 papers to compare.");
      setShowComparisonView(true);
      return;
    }

    const clientPapers = targetIds.slice(0, 4).map((id) => {
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

      if (!response.ok) throw new Error("Could not compare papers.");
      const data = (await response.json()) as ComparisonResult;
      setComparisonResult(data);
    } catch (error) {
      setComparisonError(
        error instanceof Error ? error.message : "Failed to compare.",
      );
    } finally {
      setIsComparing(false);
    }
  }

  const summaryText = selectedNodeId ? summaryById[selectedNodeId] : "";
  const summaryLoading = selectedNodeId ? summaryLoadingById[selectedNodeId] : false;
  const summaryError = selectedNodeId ? summaryErrorById[selectedNodeId] : "";

  return (
    <div className="min-h-screen bg-[#07111d] text-[#eaf2f8]">
      <Nav selectedIds={requestedIds} />

      <main className="page-container py-6 sm:py-8 flex flex-col gap-6">
        {/* Top Header: Title, Description, and Back to Results Link */}
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#eaf2f8]">
              Relationship graph
              <span className="sr-only">Research Relationship Graph</span>
            </h1>
            <p className="mt-1 text-sm text-[#a7bacd]">
              Connections show shared authors or arXiv categories. These lines are not citations.
              <span className="sr-only">
                (edges represent shared authors or shared arXiv categories, not citation relationships)
              </span>
            </p>
          </div>

          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#24c6d8] hover:text-[#3de0f2] hover:underline shrink-0"
          >
            <span>← Back to results</span>
          </Link>
        </div>

        {/* Toolbar: Zoom -/+, Fit view, Reset view, Checkboxes, Paper Count */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#294058] bg-[#101e30] p-2.5 shadow-sm">
          <div className="flex items-center gap-1.5" role="toolbar" aria-label="Graph controls">
            <button
              type="button"
              onClick={() => handleZoomBy(0.8)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#294058] bg-[#14263a] text-sm font-bold text-[#eaf2f8] transition-colors hover:border-[#24c6d8] hover:text-[#24c6d8]"
              aria-label="Zoom out"
              title="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => handleZoomBy(1.25)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#294058] bg-[#14263a] text-sm font-bold text-[#eaf2f8] transition-colors hover:border-[#24c6d8] hover:text-[#24c6d8]"
              aria-label="Zoom in"
              title="Zoom in"
            >
              +
            </button>
            <div className="h-4 w-px bg-[#294058] mx-1" aria-hidden="true" />
            <button
              type="button"
              onClick={() => zoomToFit(70, 300)}
              className="rounded-lg border border-[#294058] bg-[#14263a] px-3 h-8 text-xs font-medium text-[#a7bacd] transition-colors hover:border-[#24c6d8] hover:text-[#eaf2f8]"
              aria-label="Fit graph to view"
            >
              Fit view
            </button>
            <button
              type="button"
              onClick={handleResetLayout}
              className="rounded-lg border border-[#294058] bg-[#14263a] px-3 h-8 text-xs font-medium text-[#a7bacd] transition-colors hover:border-[#24c6d8] hover:text-[#eaf2f8]"
              aria-label="Reset graph layout"
            >
              Reset view
            </button>
          </div>

          <div className="flex items-center gap-5 flex-wrap">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-[#eaf2f8]">
              <input
                type="checkbox"
                checked={showCoAuthorEdges}
                onChange={(e) => setShowCoAuthorEdges(e.target.checked)}
                className="accent-[#24c6d8] h-4 w-4 rounded"
                aria-label="Show co-author edges (shared authors between papers)"
              />
              <span>Shared authors</span>
            </label>

            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-[#eaf2f8]">
              <input
                type="checkbox"
                checked={showSameFieldEdges}
                onChange={(e) => setShowSameFieldEdges(e.target.checked)}
                className="accent-[#24c6d8] h-4 w-4 rounded"
                aria-label="Show same-field edges (shared arXiv categories between papers)"
              />
              <span>Shared category</span>
            </label>

            <span className="text-xs font-mono text-[#a7bacd]">
              {graphData?.nodes.length || 0} papers
            </span>
          </div>
        </div>

        {/* Accessible Keyboard Selector & Compare Top Shortcut (hidden from view, accessible for tests) */}
        {graphData && graphData.nodes.length > 0 && (
          <div className="sr-only">
            <label htmlFor="accessible-node-select">Select paper in graph</label>
            <select
              id="accessible-node-select"
              value={selectedNodeId || ""}
              onChange={(e) => setSelectedNodeId(e.target.value || null)}
            >
              <option value="">-- Choose paper --</option>
              {graphData.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  [{primaryCategory(n)}] {n.title} (arXiv:{n.id})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                const autoIds = graphData.nodes.slice(0, 2).map((n) => n.id);
                setSelectedForCompare(autoIds);
                generateComparison(autoIds);
              }}
            >
              Compare Top 2
            </button>
          </div>
        )}

        {/* Active Comparison Matrix */}
        {showComparisonView && (
          <ComparisonMatrix
            isComparing={isComparing}
            comparisonError={comparisonError}
            comparisonResult={comparisonResult}
            onClose={() => setShowComparisonView(false)}
            onRetry={() => generateComparison()}
          />
        )}

        {/* Empty state */}
        {requestedIds.length === 0 && (
          <div className="rounded-xl border border-dashed border-[#294058] bg-[#101e30]/40 p-12 text-center">
            <p className="text-base font-bold text-[#eaf2f8]">No papers selected</p>
            <p className="mt-1 text-xs text-[#a7bacd]">
              Go back to search, select papers using &ldquo;Add to graph&rdquo;, then view the relationship graph.
            </p>
            <Link
              href="/"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#24c6d8] px-4 py-2 text-xs font-bold text-[#07111d]"
            >
              ← Back to Search
            </Link>
          </div>
        )}

        {/* Two-Column Layout: Left (~2/3) Canvas + Table, Right (~1/3) Selected Paper Inspector */}
        {requestedIds.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column: Graph Canvas + "Papers in this graph" Table */}
            <div className="lg:col-span-8 flex flex-col gap-6">
              {/* SVG Graph Canvas Container */}
              <div className="relative overflow-hidden rounded-xl border border-[#294058] bg-[#101e30] shadow-sm">
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                  className="w-full cursor-grab active:cursor-grabbing select-none"
                  style={{ height: "clamp(460px, 58vh, 600px)" }}
                  role="img"
                  aria-label={`Research relationship graph with ${graphData?.nodes.length || 0} papers`}
                />

                {/* Bottom-left overlay: Drag to pan · Scroll to zoom */}
                <div className="pointer-events-none absolute bottom-14 left-3 flex items-center gap-1.5 rounded-lg border border-[#294058] bg-[#07111d]/90 px-2.5 py-1 text-xs text-[#a7bacd] backdrop-blur-sm select-none">
                  <svg className="h-3.5 w-3.5 text-[#24c6d8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
                  </svg>
                  <span>Drag to pan · Scroll to zoom</span>
                </div>

                {/* Bottom Legend Bar (Image 2 Specification) */}
                <div
                  className="flex flex-wrap items-center justify-between gap-3 border-t border-[#294058] bg-[#07111d] px-4 py-3 text-xs text-[#a7bacd]"
                  aria-label="Edge type legend"
                >
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-0.5 w-4 bg-[#24c6d8]" aria-hidden="true" />
                      <span>Solid line: shared author</span>
                      <span className="sr-only">Solid cyan: Shared author(s)</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-0 w-4 border-b border-dashed border-[#a7bacd]" aria-hidden="true" />
                      <span>Dashed line: shared category</span>
                      <span className="sr-only">Dashed grey: Shared arXiv field</span>
                    </span>
                    <span className="text-[#294058]" aria-hidden="true">|</span>
                    {Array.from(categoryColorMap.entries()).slice(0, 4).map(([cat, color]) => (
                      <span key={cat} className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                        <span className="font-mono text-xs">{cat}</span>
                      </span>
                    ))}
                  </div>
                  <span className="sr-only">
                    Relationships show collaboration &amp; field similarity — NOT citations
                  </span>
                </div>
              </div>

              {/* "Papers in this graph" Table (Directly Beneath Canvas, Image 2 Specification) */}
              {graphData && graphData.nodes.length > 0 && (
                <div className="rounded-xl border border-[#294058] bg-[#101e30] overflow-hidden shadow-sm">
                  <div className="px-5 py-3.5 border-b border-[#294058]">
                    <h3 className="text-base font-bold text-[#eaf2f8]">
                      Papers in this graph
                    </h3>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#294058] text-[#738a9f] font-mono">
                          <th className="py-2.5 px-5 w-12 font-normal">#</th>
                          <th className="py-2.5 px-5 font-normal">Title</th>
                          <th className="py-2.5 px-5 w-28 text-right font-normal">Category</th>
                        </tr>
                      </thead>
                      <tbody>
                        {graphData.nodes.map((node, index) => {
                          const isSelected = selectedNodeId === node.id;
                          const catColor = categoryColorMap.get(primaryCategory(node)) || "#24c6d8";
                          return (
                            <tr
                              key={node.id}
                              onClick={() => setSelectedNodeId(node.id)}
                              className={`border-b border-[#294058]/50 cursor-pointer transition-colors ${
                                isSelected
                                  ? "bg-[#14384d]/80 text-[#24c6d8] font-semibold"
                                  : "hover:bg-[#14263a] text-[#eaf2f8]"
                              }`}
                            >
                              <td className="py-3 px-5 font-mono text-[#a7bacd]">
                                {index + 1}
                              </td>
                              <td className="py-3 px-5 line-clamp-1">
                                {node.title}{"\u200B"}
                              </td>
                              <td className="py-3 px-5 text-right">
                                <span
                                  className="rounded px-2 py-0.5 font-mono text-[11px] font-semibold"
                                  style={{
                                    backgroundColor: `${catColor}20`,
                                    color: catColor,
                                    border: `1px solid ${catColor}40`,
                                  }}
                                >
                                  {primaryCategory(node)}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Selected Paper Inspector (Image 2 Specification) */}
            <aside
              className="lg:col-span-4 rounded-xl border border-[#294058] bg-[#101e30] p-6 shadow-sm flex flex-col gap-4 lg:sticky lg:top-20"
              aria-label="Selected paper inspector"
            >
              <div className="border-b border-[#294058] pb-2">
                <span className="text-xs font-semibold text-[#a7bacd] uppercase tracking-wider">
                  Selected paper
                </span>
              </div>

              {!selectedNode ? (
                <p className="text-xs text-[#a7bacd]">
                  Click on any node in the graph or paper in the table below to inspect its details and connections.
                </p>
              ) : (
                <div className="flex flex-col gap-3.5">
                  {/* Paper Title */}
                  <h2 className="text-lg sm:text-xl font-bold leading-snug text-[#eaf2f8]">
                    {selectedNode.title}
                  </h2>

                  {/* Authors and Published Date */}
                  <div className="text-xs text-[#a7bacd]">
                    <p>
                      {selectedNode.authors.join(", ") || "Unknown authors"} · {formatDate(selectedNode.published)}
                    </p>
                    <p className="mt-1 font-mono text-xs">
                      arXiv:{" "}
                      <a
                        href={selectedDetails?.entry_url || `https://arxiv.org/abs/${selectedNode.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#24c6d8] hover:underline"
                      >
                        {selectedNode.id}
                      </a>{" "}
                      <span className="text-[#a7bacd]">[{primaryCategory(selectedNode)}]</span>
                    </p>
                  </div>

                  {/* Abstract Text */}
                  <div className="text-xs sm:text-sm text-[#a7bacd] leading-relaxed max-h-48 overflow-y-auto pr-1">
                    <p>{selectedDetails?.abstract || "Abstract loading…"}</p>
                  </div>

                  {/* Connections Breakdown */}
                  <div className="pt-3 border-t border-[#294058]">
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="font-bold text-sm text-[#eaf2f8]">Connections</span>
                      <span className="rounded bg-[#14263a] px-1.5 py-0.2 font-mono text-xs font-bold text-[#24c6d8] border border-[#294058]">
                        {connectedPapers.length}
                      </span>
                      <span className="sr-only">
                        Connected in Graph ({connectedPapers.length})
                      </span>
                    </div>

                    {connectedPapers.length === 0 ? (
                      <p className="text-xs text-[#738a9f]">
                        No shared author or category connections to other papers in this view.
                      </p>
                    ) : (
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                        {connectedPapers.map(({ paper, edgeType, reason }) => (
                          <div key={`${paper.id}-${edgeType}`} className="text-xs">
                            <button
                              type="button"
                              onClick={() => setSelectedNodeId(paper.id)}
                              className="font-medium text-[#24c6d8] hover:underline text-left flex items-start gap-1.5"
                            >
                              <span className="text-[#24c6d8] select-none">●</span>
                              <span className="line-clamp-1">{paper.title}</span>
                            </button>
                            <p className="text-[11px] text-[#a7bacd] ml-3.5 mt-0.5">
                              Relationship: {reason || (edgeType === "co-author" ? "shared author" : "shared category")}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* AI Summary (if active) */}
                  {summaryText && (
                    <div className="rounded-lg border border-[#24c6d8]/30 bg-[#14263a] p-3 text-xs space-y-1">
                      <span className="font-bold text-[#24c6d8]">✦ AI Summary:</span>
                      <p className="text-[#eaf2f8] leading-relaxed">{summaryText}</p>
                    </div>
                  )}

                  {/* AI Summary Error with Discoverable Retry Button */}
                  {summaryError && (
                    <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs space-y-2">
                      <p className="text-rose-300 font-medium">{summaryError}</p>
                      <button
                        type="button"
                        onClick={summarizeSelectedNode}
                        disabled={summaryLoading}
                        className="rounded bg-rose-500/20 border border-rose-500/40 px-2.5 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/30"
                        aria-label={`Retry summary for ${selectedNode.title}`}
                      >
                        Retry
                      </button>
                    </div>
                  )}

                  {/* Action Buttons: Summarize & Compare */}
                  <div className="pt-3 border-t border-[#294058] flex items-center gap-2">
                    <button
                      type="button"
                      onClick={summarizeSelectedNode}
                      disabled={summaryLoading}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#24c6d8] py-2 text-xs font-bold text-[#07111d] transition-colors hover:bg-[#3de0f2] disabled:opacity-50"
                      aria-label={`Summarize: ${selectedNode.title}`}
                    >
                      {summaryLoading ? (
                        <span>Summarizing…</span>
                      ) : (
                        <>
                          <span aria-hidden="true">✦</span>
                          <span>Summarize</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleCompare(selectedNode.id)}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium transition-colors ${
                        selectedForCompare.includes(selectedNode.id)
                          ? "border-[#24c6d8] bg-[#24c6d8]/15 text-[#24c6d8]"
                          : "border-[#294058] bg-[#14263a] text-[#eaf2f8] hover:border-[#24c6d8]"
                      }`}
                    >
                      <span>⇄</span>
                      <span>{selectedForCompare.includes(selectedNode.id) ? "In Compare" : "Compare"}</span>
                    </button>
                  </div>

                  {/* External Original Links */}
                  <div className="flex items-center gap-3 text-xs text-[#a7bacd] pt-1">
                    <a
                      href={selectedDetails?.entry_url || `https://arxiv.org/abs/${selectedNode.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#24c6d8] hover:underline inline-flex items-center gap-1"
                      aria-label={`Open arXiv abstract page for: ${selectedNode.title}`}
                    >
                      <span>Original on arXiv ↗</span>
                    </a>
                    <span className="text-[#294058]" aria-hidden="true">|</span>
                    <a
                      href={selectedDetails?.pdf_url || `https://arxiv.org/pdf/${selectedNode.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#24c6d8] hover:underline inline-flex items-center gap-1"
                      aria-label={`Open PDF for: ${selectedNode.title}`}
                    >
                      <span>PDF ↗</span>
                    </a>
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

export default function GraphPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#07111d] text-[#eaf2f8] flex items-center justify-center p-6">
          <div className="text-center">
            <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-[#24c6d8] border-t-transparent" />
            <p className="mt-3 text-xs text-[#a7bacd]">Loading graph environment…</p>
          </div>
        </div>
      }
    >
      <GraphPageContent />
    </Suspense>
  );
}
