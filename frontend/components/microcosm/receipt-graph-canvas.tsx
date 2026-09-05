"use client";

// The canvas half of the receipt view. It draws exactly the recorded
// dependencies the route returned and nothing else; the receipts nothing
// connects to sit in their own row underneath, labelled, rather than being
// wired into the flow on a guess.
//
// The list beside this canvas carries the same information and is the keyboard
// path through it. The canvas is therefore a labelled group rather than a
// labelled image: `role="img"` hides its whole subtree from assistive
// technology, and this one holds real controls — the zoom buttons and the
// attribution link — that a keyboard reaches and would then find unannounced.
// A group keeps the one-sentence label and leaves those controls addressable.

import { useEffect, useMemo } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";

import {
  NODE_HEIGHT,
  NODE_WIDTH,
  cacheReading,
  executionReading,
  gateReading,
  layoutReceiptGraph,
  stateFor,
} from "@/lib/microcosm/graph/presentation";
import type { ExecutionEdge, ReceiptGraphNode } from "@/lib/microcosm/graph/types";

interface CardData {
  label: string;
  nativeId: string;
  groupLabel: string;
  execution: string;
  cache: string;
  gate: string;
  unconnected: boolean;
  selected: boolean;
}

const TONE_BORDER: Record<string, string> = {
  danger: "var(--neg)",
  warning: "var(--warn)",
  success: "var(--pos)",
  info: "var(--chart-2)",
  neutral: "var(--border-strong)",
};

function ReceiptCard({ data }: NodeProps<CardData>) {
  return (
    <div
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        borderColor: data.selected ? "var(--primary)" : TONE_BORDER[data.execution],
        boxShadow: data.selected
          ? "0 0 0 2px color-mix(in srgb, var(--primary) 45%, transparent)"
          : "var(--elev-1)",
        borderStyle: data.unconnected ? "dashed" : "solid",
      }}
      className="flex flex-col justify-center gap-1 rounded-lg border-2 bg-card px-3 py-2 text-left"
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-[var(--border-strong)]" />
      <div className="truncate text-[12px] font-semibold leading-tight text-foreground">
        {data.label}
      </div>
      <div className="truncate font-mono text-[10px] leading-tight text-muted-foreground">
        {data.nativeId}
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: TONE_BORDER[data.cache] }}
        />
        <span className="truncate text-[10px] leading-none text-muted-foreground">
          {data.groupLabel}
          {data.gate !== "neutral" ? " · gate" : ""}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-[var(--border-strong)]" />
    </div>
  );
}

const NODE_TYPES = { receipt: ReceiptCard };

interface CanvasProps {
  nodes: ReceiptGraphNode[];
  edges: ExecutionEdge[];
  mode: string;
  selectedId: string;
  onSelect: (id: string) => void;
  reducedMotion: boolean;
  ariaLabel: string;
}

function Canvas({
  nodes,
  edges,
  mode,
  selectedId,
  onSelect,
  reducedMotion,
  ariaLabel,
}: CanvasProps) {
  const flow = useReactFlow();
  const positions = useMemo(() => layoutReceiptGraph(nodes, edges), [nodes, edges]);

  const flowNodes = useMemo<Node<CardData>[]>(
    () =>
      nodes.map((node) => {
        const position = positions.find((entry) => entry.id === node.id);
        const state = stateFor(node, mode);
        return {
          id: node.id,
          type: "receipt",
          position: { x: position?.x ?? 0, y: position?.y ?? 0 },
          draggable: false,
          connectable: false,
          data: {
            label: node.label,
            nativeId: node.id,
            groupLabel: node.group_label,
            execution: executionReading(state.execution).tone,
            cache: cacheReading(state.cache).tone,
            gate: gateReading(state.gate).tone,
            unconnected: node.unconnected,
            selected: node.id === selectedId,
          },
        };
      }),
    [nodes, positions, mode, selectedId],
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge) => ({
        id: `${edge.from}->${edge.to}`,
        source: edge.from,
        target: edge.to,
        type: "smoothstep",
        animated: false,
        label: edge.artifacts.map((artifact) => artifact.name).join(" · "),
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
        labelStyle: { fill: "var(--paper-dim)", fontSize: 10 },
        labelBgStyle: { fill: "var(--card)", stroke: "var(--border)" },
        style: {
          stroke:
            edge.from === selectedId || edge.to === selectedId
              ? "var(--primary)"
              : "var(--border-strong)",
          strokeWidth: edge.from === selectedId || edge.to === selectedId ? 2 : 1.4,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color:
            edge.from === selectedId || edge.to === selectedId
              ? "var(--primary)"
              : "var(--border-strong)",
        },
      })),
    [edges, selectedId],
  );

  // Bringing the selected receipt into view is a convenience, not motion the
  // reader asked for: with reduced motion it jumps rather than animates.
  useEffect(() => {
    if (!selectedId) return;
    const position = positions.find((entry) => entry.id === selectedId);
    if (!position) return;
    flow.setCenter(position.x + NODE_WIDTH / 2, position.y + NODE_HEIGHT / 2, {
      zoom: flow.getZoom(),
      duration: reducedMotion ? 0 : 320,
    });
  }, [selectedId, positions, flow, reducedMotion]);

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="h-[420px] w-full overflow-hidden rounded-md border border-border bg-card/60 sm:h-[460px]"
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        onNodeClick={(_, node) => onSelect(node.id)}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable
        proOptions={{ hideAttribution: false }}
        fitView
        fitViewOptions={{ padding: 0.18, duration: 0 }}
        minZoom={0.3}
        maxZoom={1.6}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--border-soft)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export default function ReceiptGraphCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
