import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DocsSource, ReferencePage } from '@entifix/docs-engine';
import { referenceSource } from '@entifix/docs-engine';
import { SLICES } from '@r10c/slices';

import { API_FOLDER, SERVICES_FOLDER, workspaceRoot } from './catalog';

export { API_FOLDER };
import { docsCopy, type SiteLocale } from './copy';
import { code, href, link, list, page, section, table } from './markdown';

/** Where `@r10c/docs-reference:generate` writes the documents, and where `finish.mjs` serves them. */
export const OPENAPI_DIRECTORY = join(
  'tools',
  'docs-reference',
  'out',
  'openapi',
);
export const OPENAPI_PATH = '/openapi/';

interface Schema {
  readonly [key: string]: unknown;
}

interface Operation {
  readonly operationId: string;
  readonly tags?: readonly string[];
  readonly parameters?: readonly {
    readonly name: string;
    readonly in: string;
    readonly required?: boolean;
    readonly schema?: Schema;
  }[];
  readonly requestBody?: {
    readonly content: Readonly<Record<string, { readonly schema?: Schema }>>;
  };
  readonly responses: Readonly<
    Record<
      string,
      {
        readonly description: string;
        readonly content?: Readonly<
          Record<string, { readonly schema?: Schema }>
        >;
      }
    >
  >;
}

export interface OpenApiDocument {
  readonly paths: Readonly<Record<string, Readonly<Record<string, Operation>>>>;
  readonly tags?: readonly { readonly name: string }[];
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

const PROBLEM = 'application/problem+json';

let loaded: ReadonlyMap<string, OpenApiDocument> | undefined;

/**
 * Each service's OpenAPI document by deployment, as the generator wrote it
 * from `serviceOpenApi` — the document the running service answers at
 * `$openapi` (#654). `build` and `dev` run the generator first.
 */
export const serviceDocuments = (): ReadonlyMap<string, OpenApiDocument> => {
  if (loaded !== undefined) return loaded;
  const directory = join(workspaceRoot, OPENAPI_DIRECTORY);
  if (!existsSync(directory)) {
    throw new Error(
      `docs-site: no ${OPENAPI_DIRECTORY} — run \`pnpm nx run @r10c/docs-reference:generate\``,
    );
  }
  loaded = new Map(
    readdirSync(directory)
      .filter(file => file.endsWith('.json'))
      .sort()
      .map(file => [
        file.slice(0, -'.json'.length),
        JSON.parse(
          readFileSync(join(directory, file), 'utf8'),
        ) as OpenApiDocument,
      ]),
  );
  return loaded;
};

/** `/api/x/{id}` as the fleet writes it everywhere else: `/api/x/:id`. */
const routeOf = (path: string) => path.replaceAll(/\{([^}]+)\}/g, ':$1');

/** A heading's id as the page renders it: lower case, words joined by hyphens. */
const anchorOf = (heading: string) =>
  heading.toLowerCase().replaceAll(/\s+/g, '-');

const fenced = (schema: unknown) =>
  `\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``;

/** The type a parameter's schema names, or its JSON when it names none. */
const typeOf = (schema: Schema | undefined) =>
  typeof schema?.['type'] === 'string'
    ? code(schema['type'])
    : code(JSON.stringify(schema ?? {}));

interface Entry {
  readonly method: (typeof METHODS)[number];
  readonly path: string;
  readonly operation: Operation;
}

const entriesOf = (document: OpenApiDocument): readonly Entry[] =>
  Object.entries(document.paths).flatMap(([path, operations]) =>
    METHODS.flatMap(method => {
      const operation = operations[method];
      return operation === undefined ? [] : [{ method, path, operation }];
    }),
  );

const operationMarkdown = (locale: SiteLocale, entry: Entry) => {
  const words = docsCopy(locale).api;
  const { operation } = entry;
  const parameters = operation.parameters ?? [];
  const body = Object.entries(operation.requestBody?.content ?? {});
  const responses = Object.entries(operation.responses);
  const succeeded = responses.filter(([status]) => status.startsWith('2'));
  const failed = responses
    .filter(([status]) => !status.startsWith('2'))
    .map(([status]) => status);
  return [
    `### ${code(`${entry.method.toUpperCase()} ${routeOf(entry.path)}`)}`,
    `${words.operation}: ${code(operation.operationId)}`,
    parameters.length === 0
      ? words.noParameters
      : table(
          [words.name, words.in, words.required, words.type],
          parameters.map(parameter => [
            code(parameter.name),
            parameter.in,
            parameter.required === true ? words.yes : words.no,
            typeOf(parameter.schema),
          ]),
        ),
    ...(body.length === 0
      ? [words.noBody]
      : body.flatMap(([contentType, { schema }]) => [
          `**${words.requestBody}** (${code(contentType)})`,
          ...(schema === undefined ? [] : [fenced(schema)]),
        ])),
    ...succeeded.flatMap(([status, response]) => {
      const content = Object.entries(response.content ?? {});
      return content.length === 0
        ? [`**${status}** — ${words.noContent}`]
        : content.flatMap(([contentType, { schema }]) => [
            `**${status}** (${code(contentType)})`,
            ...(schema === undefined ? [] : [fenced(schema)]),
          ]);
    }),
    `**${words.failures}**: ${list(failed.map(code), words.none)} — ${link(words.problem, `#${anchorOf(words.problem)}`)}`,
  ].join('\n\n');
};

/** The problem body every service answers a failure with, from the first one it declares. */
const problemOf = (document: OpenApiDocument): unknown =>
  entriesOf(document)
    .flatMap(({ operation }) => Object.values(operation.responses))
    .map(response => response.content?.[PROBLEM]?.schema)
    .find(schema => schema !== undefined && schema['type'] === 'object');

const sliceOf = (deployment: string) =>
  SLICES.find(slice => slice.deployments.includes(deployment));

const apiPage = (
  locale: SiteLocale,
  deployment: string,
  document: OpenApiDocument,
): ReferencePage => {
  const words = docsCopy(locale).api;
  const slice = sliceOf(deployment);
  const entries = entriesOf(document);
  const groups = (document.tags ?? []).map(tag => tag.name);
  return {
    path: [deployment],
    title: deployment,
    description: `${entries.length} ${words.operations}`,
    file: `tools/docs-reference/out/openapi/${deployment}.json`,
    markdown: page(
      [
        slice === undefined
          ? ''
          : `${words.slice}: ${link(slice.name, href(locale, SERVICES_FOLDER, slice.name))}`,
        `${link(words.download, `${OPENAPI_PATH}${deployment}.json`)} — ${words.downloadNote}`,
      ]
        .filter(line => line !== '')
        .join('\n\n'),
      ...groups.flatMap(group => {
        const inGroup = entries.filter(
          entry => entry.operation.tags?.[0] === group,
        );
        return inGroup.length === 0
          ? []
          : [
              section(
                group,
                inGroup
                  .map(entry => operationMarkdown(locale, entry))
                  .join('\n\n'),
              ),
            ];
      }),
      section(
        words.problem,
        `${words.problemNote}\n\n${fenced(problemOf(document) ?? {})}`,
      ),
    ),
  };
};

/** One page per service: every operation it serves, read-only (#654). */
export const apiSource = (locale: SiteLocale): DocsSource => {
  const words = docsCopy(locale).api;
  const documents = serviceDocuments();
  return referenceSource(API_FOLDER, words.title, () => [
    {
      path: [],
      title: words.title,
      description: words.description,
      file: 'tools/docs-reference/src/openapi.ts',
      markdown: page(
        words.intro,
        [...documents.keys()]
          .map(
            deployment =>
              `- ${link(deployment, href(locale, API_FOLDER, deployment))}`,
          )
          .join('\n'),
      ),
    },
    ...[...documents].map(([deployment, document]) =>
      apiPage(locale, deployment, document),
    ),
  ]);
};
