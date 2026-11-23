import { docsCopy, isSiteLocale, type SiteLocale } from '../content/copy';
import {
  FLOW_SCHEME,
  type FlowScenario,
  kindOf,
  outcomeTitle,
  scenarioOf,
  type StepKind,
  stepsOf,
  stepTitle,
} from '../content/flows';
import {
  FlowCanvas,
  type FlowCanvasEdge,
  type FlowCanvasNode,
  type Stroke,
} from './flow-canvas';

/** Told apart by stroke, never by colour alone: the legend says which is which. */
export const STROKE: Readonly<Record<StepKind, Stroke>> = {
  pivot: { width: 4, style: 'solid' },
  wait: { width: 2, style: 'dotted', dash: '2 4' },
  compensatable: { width: 1.5, style: 'dashed', dash: '7 4' },
  retriable: { width: 1.5, style: 'solid' },
};

/** About how wide an 11px italic caption runs, per character. */
const CAPTION_CHARACTER = 6;

/**
 * An outcome's caption beside its arrowhead: to the right, or to the left
 * when the right would run past the drawing's edge.
 */
const captionAt = (
  [x]: readonly [number, number],
  caption: string,
  width: number,
) =>
  x + 6 + caption.length * CAPTION_CHARACTER > width
    ? { x: x - 6, textAnchor: 'end' as const }
    : { x: x + 6 };

/** A caption in at most two lines, broken between words. */
const linesOf = (caption: string, width = 30): readonly string[] => {
  const words = caption.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current === '' ? word : `${current} ${word}`;
    if (next.length > width && current !== '') {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  lines.push(current);
  return lines.length <= 2
    ? lines
    : [
        lines[0] ?? '',
        `${lines
          .slice(1)
          .join(' ')
          .slice(0, width - 1)}…`,
      ];
};

/** What both drawings are made from: the steps placed, captioned and styled. */
const drawingOf = (lang: SiteLocale, scenario: FlowScenario) => {
  const steps = new Map(stepsOf(scenario).map(step => [step.step, step]));
  const nodes: FlowCanvasNode[] = scenario.layout.nodes.map(node => {
    const step = steps.get(node.step);
    if (step === undefined) {
      throw new Error(`docs-site: '${node.step}' is placed but not a step`);
    }
    return {
      id: node.step,
      x: node.x,
      y: node.y,
      lines: linesOf(stepTitle(lang, node.step)),
      participant: step.participant ?? docsCopy(lang).flows.coordinator,
      kind: kindOf(step),
    };
  });
  const edges: FlowCanvasEdge[] = scenario.layout.edges.map(edge => ({
    id: `${edge.from}->${edge.to}`,
    from: edge.from,
    to: edge.to,
    points: edge.points,
    label:
      edge.outcomes === undefined
        ? undefined
        : edge.outcomes.map(outcome => outcomeTitle(lang, outcome)).join(' / '),
  }));
  return { nodes, edges };
};

function StaticFlow({
  title,
  width,
  height,
  markerId,
  box,
  nodes,
  edges,
}: {
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly markerId: string;
  readonly box: { readonly width: number; readonly height: number };
  readonly nodes: readonly FlowCanvasNode[];
  readonly edges: readonly FlowCanvasEdge[];
}) {
  return (
    <svg
      role="img"
      aria-label={title}
      viewBox={`0 0 ${width} ${height}`}
      style={{ maxWidth: width }}
      className="mx-auto block h-auto w-full text-content"
    >
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
      </defs>
      {edges.map(edge => {
        // Beside the arrowhead, so two branches leaving one wait never share a caption's place.
        const end = edge.points.at(-1);
        return (
          <g key={edge.id}>
            <polyline
              points={edge.points.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none"
              stroke="currentColor"
              markerEnd={`url(#${markerId})`}
            />
            {edge.label === undefined || end === undefined ? null : (
              <text
                {...captionAt(end, edge.label, width)}
                y={end[1] - 8}
                fill="currentColor"
                fontSize="11"
                fontStyle="italic"
              >
                {edge.label}
              </text>
            )}
          </g>
        );
      })}
      {nodes.map(node => {
        const stroke = STROKE[node.kind];
        return (
          <g key={node.id}>
            <rect
              x={node.x}
              y={node.y}
              width={box.width}
              height={box.height}
              rx="6"
              strokeWidth={stroke.width}
              strokeDasharray={stroke.dash}
              className="fill-surface-elevated stroke-current"
            />
            {node.lines.map((line, index) => (
              <text
                key={line}
                x={node.x + 10}
                y={node.y + 20 + index * 16}
                fill="currentColor"
                fontSize="13"
              >
                {line}
              </text>
            ))}
            <text
              x={node.x + 10}
              y={node.y + box.height - 10}
              fill="currentColor"
              fontFamily="monospace"
              fontSize="11"
            >
              {node.participant}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * One flow's diagram (#687), from the address its markdown gave it:
 * `/flow-map/<locale>/<scenario>`. Static SVG laid out at build time, readable
 * with no script; with one, a reader may open the same placement as a canvas
 * to pan and zoom.
 */
export function FlowMap({ src }: { readonly src: string }) {
  const [lang = '', id = ''] = src.slice(FLOW_SCHEME.length).split('/');
  const scenario = scenarioOf(id);
  if (!isSiteLocale(lang) || scenario === undefined) {
    throw new Error(`docs-site: no flow at ${src}`);
  }
  const words = docsCopy(lang).flows;
  const { nodes, edges } = drawingOf(lang, scenario);
  const { width, height } = scenario.layout;
  return (
    <FlowCanvas
      nodes={nodes}
      edges={edges}
      width={width}
      height={height}
      strokes={STROKE}
      box={scenario.layout.box}
      open={words.interactive}
      close={words.static}
    >
      <StaticFlow
        title={words.diagram}
        width={width}
        height={height}
        markerId={`flow-${id}-arrow`}
        box={scenario.layout.box}
        nodes={nodes}
        edges={edges}
      />
    </FlowCanvas>
  );
}
