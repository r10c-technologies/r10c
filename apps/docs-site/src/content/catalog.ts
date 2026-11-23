import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { DocsSource, ReferencePage } from '@entifix/docs-engine';
import { referenceSource } from '@entifix/docs-engine';
import { DOMAINS } from '@r10c/capabilities';
import {
  FLEET,
  type SliceDeclaration,
  SLICES,
  type StoreDeclaration,
} from '@r10c/slices';

import { docsCopy, type SiteLocale } from './copy';
import {
  code,
  facts,
  href,
  link,
  list,
  page,
  section,
  table,
} from './markdown';

export const SERVICES_FOLDER = 'services';
export const STORES_FOLDER = 'stores';
/** Each deployment's OpenAPI pages (`api.ts`), linked from its slice's page. */
export const API_FOLDER = 'api';

/** A service's inspector is its port + 6000 (`docs/_shared/ports.md`). */
const INSPECTOR_OFFSET = 6000;

export const workspaceRoot = (() => {
  let directory = process.cwd();
  while (!existsSync(join(directory, 'pnpm-workspace.yaml'))) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(
        'docs-site: no pnpm-workspace.yaml above the working directory',
      );
    }
    directory = parent;
  }
  return directory;
})();

/** A deployment's `nx.tags`, read from its own `package.json`. */
export const tagsOf = (project: string): readonly string[] => {
  const file = join(workspaceRoot, 'apps', project, 'package.json');
  if (!existsSync(file)) return [];
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
    nx?: { tags?: string[] };
  };
  return manifest.nx?.tags ?? [];
};

/** Every store, with the one slice that writes it (ADR 0020). */
export const STORES = SLICES.flatMap(slice =>
  slice.stores.map(store => ({ store, writer: slice })),
);

const domainLink = (locale: SiteLocale, domain: string) => {
  const row = DOMAINS.find(candidate => candidate.domain === domain);
  return row === undefined
    ? code(domain)
    : link(row.capability, href(locale, domain));
};

const storeLink = (locale: SiteLocale, name: string) =>
  link(name, href(locale, STORES_FOLDER, name));

const sliceLink = (locale: SiteLocale, name: string) =>
  link(name, href(locale, SERVICES_FOLDER, name));

const codes = (values: readonly string[], empty: string) =>
  list(values.map(code), empty);

const slicePage = (
  locale: SiteLocale,
  slice: SliceDeclaration,
): ReferencePage => {
  const words = docsCopy(locale).catalog;
  return {
    path: [slice.name],
    title: slice.name,
    description: `${words.kinds.system} · ${words.sliceStatuses[slice.status]}`,
    file: `tools/slices/src/slices/${slice.name}.slice.ts`,
    markdown: page(
      facts([
        [words.kind, words.kinds.system],
        [words.status, words.sliceStatuses[slice.status]],
        [
          words.domains,
          list(
            slice.domains.map(domain => domainLink(locale, domain)),
            words.noDomain,
          ),
        ],
        [
          words.stores,
          list(
            slice.stores.map(store => storeLink(locale, store.name)),
            words.noStore,
          ),
        ],
        [
          words.coDeployedWith,
          list(
            slice.coDeployedWith.map(name => sliceLink(locale, name)),
            words.none,
          ),
        ],
      ]),
      section(
        `${words.deployments} (${words.kinds.component})`,
        slice.deployments.length === 0
          ? words.noDeployment
          : table(
              [words.deployments, words.port, words.inspector, words.tags],
              slice.deployments.map(project => {
                const port = FLEET.find(
                  entry => entry.project === project,
                )?.port;
                return [
                  link(project, href(locale, API_FOLDER, project)),
                  port === undefined ? '—' : code(String(port)),
                  port === undefined
                    ? '—'
                    : code(String(port + INSPECTOR_OFFSET)),
                  codes(tagsOf(project), words.none),
                ];
              }),
            ),
      ),
      section(
        `${words.exposedAPIs} (${words.kinds.api})`,
        codes(slice.exposedAPIs, words.none),
      ),
      section(words.dependantAPIs, codes(slice.dependantAPIs, words.none)),
      section(words.publishedEvents, codes(slice.publishedEvents, words.none)),
      section(
        words.subscriptions,
        slice.subscriptions.length === 0
          ? words.none
          : table(
              [
                words.subscription.event,
                words.subscription.mode,
                words.subscription.attempts,
                words.subscription.dedupe,
              ],
              slice.subscriptions.map(subscription => [
                code(subscription.event),
                code(subscription.mode),
                String(subscription.maxAttempts),
                code(subscription.dedupe),
              ]),
            ),
      ),
    ),
  };
};

/** `projection-of:<store>` → `<store>`, or `undefined` for a system of record. */
export const projectedFrom = (store: StoreDeclaration) =>
  store.truth.startsWith('projection-of:')
    ? store.truth.slice('projection-of:'.length)
    : undefined;

const storePage = (
  locale: SiteLocale,
  store: StoreDeclaration,
  writer: SliceDeclaration,
): ReferencePage => {
  const words = docsCopy(locale).catalog;
  const source = projectedFrom(store);
  return {
    path: [store.name],
    title: store.name,
    description: `${words.kinds.resource} · ${words.planes[store.plane]}`,
    file: `tools/slices/src/slices/${writer.name}.slice.ts (${store.name})`,
    markdown: page(
      facts([
        [words.kind, words.kinds.resource],
        [words.writer, sliceLink(locale, writer.name)],
        [words.plane, words.planes[store.plane]],
        [words.partitioning, words.partitionings[store.partitioning]],
        [
          words.truth,
          source === undefined
            ? words.systemOfRecord
            : `${words.projectionOf} ${storeLink(locale, source)}`,
        ],
        [
          words.hosts,
          list(
            store.hosts.map(domain => domainLink(locale, domain)),
            words.noHosts,
          ),
        ],
        ...(store.bindingReason === undefined
          ? []
          : [[words.binding, store.bindingReason] as const]),
      ]),
    ),
  };
};

/**
 * The service catalog (#653): each slice as a System with its deployments as
 * Components, its stores as Resources and its routes as APIs, all read from
 * `tools/slices/` and the deployments' own `package.json`.
 */
export const servicesSource = (locale: SiteLocale): DocsSource => {
  const words = docsCopy(locale).catalog;
  return referenceSource(SERVICES_FOLDER, words.title, () => [
    {
      path: [],
      title: words.title,
      description: words.description,
      file: 'tools/slices/src/registry.ts',
      markdown: page(
        table(
          [words.slice, words.status, words.deployments, words.stores],
          SLICES.map(slice => [
            sliceLink(locale, slice.name),
            words.sliceStatuses[slice.status],
            codes(slice.deployments, words.noDeployment),
            list(
              slice.stores.map(store => storeLink(locale, store.name)),
              words.noStore,
            ),
          ]),
        ),
      ),
    },
    ...SLICES.map(slice => slicePage(locale, slice)),
  ]);
};

/** Every store, by plane, with its single writer (ADR 0020). */
export const storesSource = (locale: SiteLocale): DocsSource => {
  const words = docsCopy(locale).catalog;
  const sorted = [...STORES].sort((a, b) =>
    a.store.name.localeCompare(b.store.name),
  );
  return referenceSource(STORES_FOLDER, words.storesTitle, () => [
    {
      path: [],
      title: words.storesTitle,
      description: words.storesDescription,
      file: 'tools/slices/src/registry.ts (stores)',
      markdown: page(
        `${link(words.mapLink, href(locale, 'store-map'))} — ${words.mapDescription}`,
        table(
          [words.store, words.plane, words.writer, words.truth],
          sorted.map(({ store, writer }) => {
            const source = projectedFrom(store);
            return [
              storeLink(locale, store.name),
              words.planes[store.plane],
              sliceLink(locale, writer.name),
              source === undefined
                ? words.systemOfRecord
                : `${words.projectionOf} ${code(source)}`,
            ];
          }),
        ),
      ),
    },
    ...sorted.map(({ store, writer }) => storePage(locale, store, writer)),
  ]);
};
