'use client';

import '@xyflow/react/dist/style.css';

import {
  Background,
  BaseEdge,
  Controls,
  type Edge,
  type EdgeProps,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from '@xyflow/react';
import { type ReactNode, useState, useSyncExternalStore } from 'react';

import type { StepKind } from '../content/flows';

export interface FlowCanvasNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly lines: readonly string[];
  readonly participant: string;
  readonly kind: StepKind;
}

export interface FlowCanvasEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly points: readonly (readonly [number, number])[];
  readonly label?: string;
}

/** A step's border: the SVG draws `dash`, the canvas's CSS border `style`. */
export interface Stroke {
  readonly width: number;
  readonly style: 'solid' | 'dashed' | 'dotted';
  readonly dash?: string;
}

type StepNode = Node<
  {
    readonly lines: readonly string[];
    readonly participant: string;
    readonly stroke: Stroke;
    readonly box: { readonly width: number; readonly height: number };
  },
  'step'
>;

type PlacedEdge = Edge<
  { readonly points: readonly (readonly [number, number])[] },
  'placed'
>;

/** A handle the edges attach to; nothing is connected by hand. */
const HIDDEN = { opacity: 0, pointerEvents: 'none' } as const;

function StepBox({ data }: NodeProps<StepNode>) {
  return (
    <div
      className="rounded-md bg-surface-elevated px-2.5 py-2 text-content"
      style={{
        width: data.box.width,
        height: data.box.height,
        borderStyle: data.stroke.style,
        borderWidth: data.stroke.width,
        borderColor: 'currentColor',
      }}
    >
      <Handle type="target" position={Position.Top} style={HIDDEN} />
      {data.lines.map(line => (
        <span key={line} className="block text-[13px] leading-4">
          {line}
        </span>
      ))}
      <span className="block text-[11px]" style={{ fontFamily: 'monospace' }}>
        {data.participant}
      </span>
      <Handle type="source" position={Position.Bottom} style={HIDDEN} />
    </div>
  );
}

/** The route ELK chose at build time, drawn as it was laid out. */
function Placed({ id, data, label, markerEnd }: EdgeProps<PlacedEdge>) {
  const points = data?.points ?? [];
  const [first, ...rest] = points;
  if (first === undefined) return null;
  const path = `M ${first[0]} ${first[1]} ${rest.map(([x, y]) => `L ${x} ${y}`).join(' ')}`;
  const last = rest.at(-1) ?? first;
  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      label={label}
      labelX={last[0]}
      labelY={last[1] - 14}
    />
  );
}

const NODE_TYPES = { step: StepBox };
const NO_SUBSCRIPTION = () => () => undefined;
const EDGE_TYPES = { placed: Placed };

/**
 * The flow's diagram, static until a reader asks for the canvas. The static
 * SVG is what an exported page carries and what a reader without script
 * sees; the button exists only once this has hydrated, so it never promises
 * what cannot run. React Flow's attribution stays: the free licence asks it.
 */
export function FlowCanvas({
  children,
  nodes,
  edges,
  width,
  height,
  strokes,
  box,
  open,
  close,
}: {
  readonly children: ReactNode;
  readonly nodes: readonly FlowCanvasNode[];
  readonly edges: readonly FlowCanvasEdge[];
  readonly width: number;
  readonly height: number;
  readonly strokes: Readonly<Record<StepKind, Stroke>>;
  readonly box: { readonly width: number; readonly height: number };
  readonly open: string;
  readonly close: string;
}) {
  // `false` in the exported HTML and on hydration, `true` after: the server
  // snapshot is what a reader without script keeps.
  const hydrated = useSyncExternalStore(
    NO_SUBSCRIPTION,
    () => true,
    () => false,
  );
  const [interactive, setInteractive] = useState(false);

  return (
    <div>
      {hydrated ? (
        <button
          type="button"
          className="mb-3 min-h-6 rounded-md border border-border-control px-3 py-1 text-sm"
          aria-pressed={interactive}
          onClick={() => setInteractive(current => !current)}
        >
          {interactive ? close : open}
        </button>
      ) : null}
      {interactive ? (
        <div
          className="w-full rounded-md border border-border-control"
          style={{ height: Math.min(Math.max(height, 480), 720) }}
        >
          <ReactFlow<StepNode, PlacedEdge>
            nodes={nodes.map(node => ({
              id: node.id,
              type: 'step',
              position: { x: node.x, y: node.y },
              data: {
                lines: node.lines,
                participant: node.participant,
                stroke: strokes[node.kind],
                box,
              },
              draggable: false,
              connectable: false,
            }))}
            edges={edges.map(edge => ({
              id: edge.id,
              type: 'placed',
              source: edge.from,
              target: edge.to,
              label: edge.label,
              markerEnd: { type: MarkerType.ArrowClosed },
              data: { points: edge.points },
            }))}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            nodesConnectable={false}
            fitView
            fitViewOptions={{ padding: 0.1 }}
            translateExtent={[
              [-width, -height],
              [width * 2, height * 2],
            ]}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
