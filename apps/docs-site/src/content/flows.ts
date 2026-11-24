import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DocsSource, ReferencePage } from '@entifix/docs-engine';
import { referenceSource } from '@entifix/docs-engine';
import { SLICES } from '@r10c/slices';

import { SERVICES_FOLDER, workspaceRoot } from './catalog';
import { docsCopy, type SiteLocale } from './copy';
import { lifecycleIndex, lifecyclePage,LIFECYCLES } from './lifecycles';
import { code, href, link, page, section, table } from './markdown';

export const FLOWS_FOLDER = 'flows';

/** Where a page's markdown asks for its flow's diagram (`Figure` draws it). */
export const FLOW_SCHEME = '/flow-map/';

export type StepKind = 'pivot' | 'wait' | 'compensatable' | 'retriable';

interface Call {
  readonly method: string;
  readonly path: string;
}

export interface FlowStep {
  readonly ref: string;
  readonly step: string;
  readonly participant?: string;
  readonly call?: Call;
  readonly compensation?: Call;
  readonly guard?: {
    readonly wait: string;
    readonly outcomes: readonly string[];
  };
}

export interface FlowLayout {
  /** Every step's box, the size the generator laid them out at. */
  readonly box: { readonly width: number; readonly height: number };
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly {
    readonly step: string;
    readonly x: number;
    readonly y: number;
  }[];
  readonly edges: readonly {
    readonly from: string;
    readonly to: string;
    readonly outcomes?: readonly string[];
    readonly points: readonly (readonly [number, number])[];
  }[];
}

export interface FlowScenario {
  readonly id: string;
  readonly recipe: string;
  readonly stages: readonly {
    readonly name: string;
    readonly steps: readonly FlowStep[];
  }[];
  readonly layout: FlowLayout;
}

interface FlowCatalog {
  readonly recipes: readonly string[];
  readonly scenarios: readonly FlowScenario[];
  readonly fragments: readonly {
    readonly ref: string;
    readonly kind: StepKind;
  }[];
}

export const FLOW_CATALOG_FILE = join(
  'tools',
  'docs-reference',
  'out',
  'flow-catalog.json',
);

let loaded: FlowCatalog | undefined;

/**
 * The composed flows, as `@r10c/docs-reference:generate` wrote them. The site
 * may not import the shell that holds the recipes, so it reads what the
 * generator composed from them; `build` and `dev` run the generator first.
 */
export const flowCatalog = (): FlowCatalog => {
  if (loaded !== undefined) return loaded;
  const file = join(workspaceRoot, FLOW_CATALOG_FILE);
  if (!existsSync(file)) {
    throw new Error(
      `docs-site: no ${FLOW_CATALOG_FILE} — run \`pnpm nx run @r10c/docs-reference:generate\``,
    );
  }
  loaded = JSON.parse(readFileSync(file, 'utf8')) as FlowCatalog;
  return loaded;
};

export const scenarioOf = (id: string) =>
  flowCatalog().scenarios.find(scenario => scenario.id === id);

export const stepsOf = (scenario: FlowScenario) =>
  scenario.stages.flatMap(stage => stage.steps);

/** A step's kind, as the catalog declares the fragment it pins. */
export const kindOf = (step: FlowStep): StepKind => {
  const fragment = flowCatalog().fragments.find(
    candidate => candidate.ref === step.ref,
  );
  if (fragment === undefined) {
    throw new Error(`docs-site: no fragment ${step.ref} in the flow catalog`);
  }
  return fragment.kind;
};

/**
 * A step's caption, by its name in the slip (`order.close-fulfilled`): a slip
 * may run one fragment under two names, and each is captioned for what it
 * does there. Missing copy fails the build, as for every other page.
 */
export const stepTitle = (locale: SiteLocale, step: string): string => {
  const [module = '', ...rest] = step.split('.');
  const words = docsCopy(locale).flows.steps as unknown as Readonly<
    Record<string, Readonly<Record<string, string>> | undefined>
  >;
  const title = words[module]?.[rest.join('.')];
  if (title === undefined) {
    throw new Error(`docs-site: no flows.steps copy for '${step}' (${locale})`);
  }
  return title;
};

export const outcomeTitle = (locale: SiteLocale, outcome: string): string => {
  const words = docsCopy(locale).flows.outcomes as Readonly<
    Record<string, string | undefined>
  >;
  const title = words[outcome];
  if (title === undefined) {
    throw new Error(
      `docs-site: no flows.outcomes copy for '${outcome}' (${locale})`,
    );
  }
  return title;
};

const scenarioWords = (locale: SiteLocale, id: string) => {
  const words = docsCopy(locale).flows.scenarios as Readonly<
    Record<
      string,
      { readonly title: string; readonly description: string } | undefined
    >
  >;
  const entry = words[id];
  if (entry === undefined) {
    throw new Error(
      `docs-site: no flows.scenarios copy for '${id}' (${locale})`,
    );
  }
  return entry;
};

const callOf = ({ method, path }: Call) => code(`${method} ${path}`);

const scenarioPage = (
  locale: SiteLocale,
  scenario: FlowScenario,
): ReferencePage => {
  const words = docsCopy(locale).flows;
  const { title, description } = scenarioWords(locale, scenario.id);
  const columns = words.columns;
  return {
    path: [scenario.id],
    title,
    description,
    file: 'packages/shells/effect/flow-catalog/src/catalog.ts',
    markdown: page(
      `![${words.diagram}](${FLOW_SCHEME}${locale}/${scenario.id})`,
      section(
        words.legendTitle,
        (['pivot', 'wait', 'compensatable', 'retriable'] as const)
          .map(kind => `- ${words.legend[kind]}`)
          .join('\n'),
      ),
      table(
        [
          columns.order,
          columns.step,
          columns.kind,
          columns.service,
          columns.call,
          columns.undo,
          columns.when,
        ],
        stepsOf(scenario).map((step, index) => [
          String(index + 1),
          `${stepTitle(locale, step.step)} (${code(step.ref)})`,
          words.kinds[kindOf(step)],
          step.participant === undefined
            ? words.coordinator
            : link(
                step.participant,
                href(
                  locale,
                  SERVICES_FOLDER,
                  sliceOfDeployment(step.participant),
                ),
              ),
          step.call === undefined ? '' : callOf(step.call),
          step.compensation === undefined
            ? words.notUndone
            : callOf(step.compensation),
          step.guard === undefined
            ? words.always
            : `${stepTitle(locale, step.guard.wait)} ${words.answeredWith}: ${step.guard.outcomes
                .map(outcome => outcomeTitle(locale, outcome))
                .join(', ')}`,
        ]),
      ),
    ),
  };
};

/** The slice a participant deploys, from the register rather than from its name. */
const sliceOfDeployment = (deployment: string) => {
  const slice = SLICES.find(candidate =>
    candidate.deployments.includes(deployment),
  );
  if (slice === undefined) {
    throw new Error(`docs-site: no slice deploys '${deployment}'`);
  }
  return slice.name;
};

/** The MVP's flows, one page each, in the order a sale lives them (#687). */
export const flowsSource = (locale: SiteLocale): DocsSource => {
  const words = docsCopy(locale).flows;
  const { scenarios } = flowCatalog();
  return referenceSource(FLOWS_FOLDER, words.title, () => [
    {
      path: [],
      title: words.title,
      description: words.description,
      file: 'packages/shells/effect/flow-catalog/src/catalog.ts',
      markdown: page(
        words.intro,
        scenarios
          .map(scenario => {
            const entry = scenarioWords(locale, scenario.id);
            return `- ${link(entry.title, href(locale, FLOWS_FOLDER, scenario.id))} — ${entry.description}`;
          })
          .join('\n'),
        section(
          words.lifecycles.title,
          `${words.lifecycles.intro}\n\n${lifecycleIndex(locale, [FLOWS_FOLDER])}`,
        ),
      ),
    },
    ...scenarios.map(scenario => scenarioPage(locale, scenario)),
    ...LIFECYCLES.map(lifecycle => lifecyclePage(locale, lifecycle, [])),
  ]);
};
