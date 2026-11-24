/**
 * Where each step of a scenario is drawn, laid out by ELK once at generate
 * time, so the site's static SVG and its interactive canvas place every box
 * at the same point and neither needs a layout engine in the browser (#687).
 */
import elkBundled from 'elkjs/lib/elk.bundled.js';
import type {
  ELK as Elk,
  ELKConstructorArguments,
  ElkNode,
} from 'elkjs/lib/elk-api.js';

import type { ScenarioDocument, ScenarioStep } from './scenarios.js';

/** Every box is one size: a step's caption is the site's to fit. */
export const STEP_BOX = { width: 240, height: 72 } as const;

export interface ScenarioEdge {
  readonly from: string;
  readonly to: string;
  /** The wait's answers this edge is taken on; absent for the next step in order. */
  readonly outcomes?: readonly string[];
}

export interface PlacedEdge extends ScenarioEdge {
  readonly points: readonly (readonly [number, number])[];
}

export interface ScenarioLayout {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly {
    readonly step: string;
    readonly x: number;
    readonly y: number;
  }[];
  readonly edges: readonly PlacedEdge[];
}

const branchOf = (step: ScenarioStep) =>
  step.guard === undefined
    ? undefined
    : `${step.guard.wait}=${step.guard.outcomes.join(',')}`;

/**
 * The order a slip runs in, as arrows. A step follows the step before it; a
 * step guarded on a wait's answers starts a branch from that wait, and each
 * further step on the same answers follows the branch's last one. That is the
 * only branching a slip has (`SlipGuard`).
 */
export const scenarioEdges = (
  scenario: ScenarioDocument,
): readonly ScenarioEdge[] => {
  const steps = scenario.stages.flatMap(stage => stage.steps);
  const edges: ScenarioEdge[] = [];
  const branchEnds = new Map<string, string>();
  let previous: string | undefined;
  for (const step of steps) {
    const branch = branchOf(step);
    if (branch === undefined || step.guard === undefined) {
      if (previous !== undefined) edges.push({ from: previous, to: step.step });
      previous = step.step;
      continue;
    }
    const end = branchEnds.get(branch);
    edges.push(
      end === undefined
        ? {
            from: step.guard.wait,
            to: step.step,
            outcomes: step.guard.outcomes,
          }
        : { from: end, to: step.step },
    );
    branchEnds.set(branch, step.step);
  }
  return edges;
};

// A CommonJS bundle whose `module.exports` is the class itself, which is what
// Node hands an ES default import; `nodenext` types it as the module instead.
const ELK = elkBundled as unknown as new (
  args?: ELKConstructorArguments,
) => Elk;
const elk = new ELK();

/**
 * Positions read off ELK's answer. Every field ELK leaves optional is filled
 * for a layered layout; a missing one reads as the origin, or as an edge with
 * no route, rather than as a failed build.
 */
export const placedFrom = (
  graph: ElkNode,
  edges: readonly ScenarioEdge[],
): ScenarioLayout => {
  const placed = new Map(
    (graph.edges ?? []).map(edge => [edge.id, edge.sections?.[0]]),
  );
  return {
    width: Math.ceil(graph.width ?? 0),
    height: Math.ceil(graph.height ?? 0),
    nodes: (graph.children ?? []).map(node => ({
      step: node.id,
      x: Math.round(node.x ?? 0),
      y: Math.round(node.y ?? 0),
    })),
    edges: edges.map((edge, index) => {
      const section = placed.get(`e${index}`);
      const points =
        section === undefined
          ? []
          : [
              section.startPoint,
              ...(section.bendPoints ?? []),
              section.endPoint,
            ].map(point => [Math.round(point.x), Math.round(point.y)] as const);
      return { ...edge, points };
    }),
  };
};

/** The scenario laid out top to bottom, branches side by side. */
export const layoutScenario = async (
  scenario: ScenarioDocument,
): Promise<ScenarioLayout & { readonly box: typeof STEP_BOX }> => {
  const steps = scenario.stages.flatMap(stage => stage.steps);
  const edges = scenarioEdges(scenario);
  const graph = await elk.layout({
    id: scenario.id,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '40',
      'elk.spacing.nodeNode': '32',
      'elk.padding': '[top=8,left=8,bottom=8,right=8]',
    },
    children: steps.map(step => ({
      id: step.step,
      width: STEP_BOX.width,
      height: STEP_BOX.height,
    })),
    edges: edges.map((edge, index) => ({
      id: `e${index}`,
      sources: [edge.from],
      targets: [edge.to],
    })),
  });
  // The size goes with the placement, so the site draws the boxes ELK placed.
  return { ...placedFrom(graph, edges), box: STEP_BOX };
};
