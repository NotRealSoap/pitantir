"use client";

import { useEffect, useMemo, useRef } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import type {
  AccountHistoryGraphEdge,
  AccountHistoryGraphNode,
} from "@pitantir/shared/account-history";

export interface OwnershipGraphProps {
  nodes: AccountHistoryGraphNode[];
  links: AccountHistoryGraphEdge[];
  height?: number;
}

type GraphNode = AccountHistoryGraphNode & { name?: string };
type GraphLink = {
  id: string;
  source: string;
  target: string;
  label?: string;
  certainty?: string | null;
};

export function OwnershipGraph({ nodes, links, height = 420 }: OwnershipGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const widthRef = useRef(640);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      widthRef.current = el.clientWidth || 640;
      graphRef.current?.d3ReheatSimulation();
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const data = useMemo(() => {
    const seenNodes = new Set<string>();
    const uniqueNodes = nodes
      .filter((node) => {
        if (seenNodes.has(node.id)) return false;
        seenNodes.add(node.id);
        return true;
      })
      .map((node) => ({ ...node, name: node.label }));

    const nodeIds = new Set(uniqueNodes.map((node) => node.id));
    const seenLinks = new Set<string>();
    const uniqueLinks = links
      .filter((link) => {
        if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) return false;
        if (seenLinks.has(link.id)) return false;
        seenLinks.add(link.id);
        return true;
      })
      .map((link) => ({
        id: link.id,
        source: link.source,
        target: link.target,
        label: link.label,
        certainty: link.certainty,
      }));

    return { nodes: uniqueNodes, links: uniqueLinks };
  }, [nodes, links]);

  if (nodes.length === 0) {
    return <p className="muted">No graph nodes for the current filters.</p>;
  }

  return (
    <div ref={containerRef} className="ownership-graph" style={{ width: "100%", height }}>
      <ForceGraph2D
        ref={graphRef}
        width={widthRef.current}
        height={height}
        graphData={data}
        nodeLabel={(node) => (node as GraphNode).label}
        linkLabel={(link) => (link as GraphLink).label ?? ""}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const n = node as GraphNode & { x?: number; y?: number };
          const x = n.x ?? 0;
          const y = n.y ?? 0;
          const isAccount = n.kind === "account";
          const radius = (n.emphasized ? 7 : 5) / Math.sqrt(globalScale);
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, 2 * Math.PI, false);
          ctx.fillStyle = isAccount
            ? n.emphasized
              ? "#e0b14a"
              : "#4ecdc4"
            : "#c084fc";
          ctx.fill();
          const label = n.label;
          const fontSize = 12 / globalScale;
          ctx.font = `${fontSize}px Manrope, sans-serif`;
          ctx.fillStyle = "#e8edf5";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(label.slice(0, 24), x, y + radius + 2);
        }}
        linkColor={() => "rgba(154, 167, 189, 0.55)"}
        backgroundColor="rgba(0,0,0,0)"
        cooldownTicks={80}
      />
    </div>
  );
}
