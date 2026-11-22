import { type Permission, permissionMatches } from '@entifix/authz';
import type { DocsSource, ReferencePage } from '@entifix/docs-engine';
import { referenceSource } from '@entifix/docs-engine';
import {
  ROLE_PERMISSIONS,
  SERVICE_CROSSING_PERMISSIONS,
} from '@r10c/business-ts-authz-grants';
import {
  CAPABILITIES,
  type Capability,
  type DomainRow,
  DOMAINS,
} from '@r10c/capabilities';

import { actionTitle, docsCopy, entityLabel, type SiteLocale } from './copy';
import { entityMap } from './entity-map';
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
import { storeOf } from './stores';

/** What marks an image as a use case's entity map rather than a file. */
export const MAP_SCHEME = '/entity-map/';

/** `<domain>:<entityKey>:<action>`, split. */
export const partsOf = (capability: Capability) => {
  const [domain = '', entityKey = '', action = ''] = capability.id.split(':');
  return { domain, entityKey, action };
};

/** Where an entry's page lives: `/<locale>/<domain>/<entityKey>--<action>/`. */
export const capabilitySlugs = (capability: Capability) => {
  const { domain, entityKey, action } = partsOf(capability);
  return [domain, `${entityKey}--${action}`] as const;
};

export const capabilityHref = (locale: SiteLocale, capability: Capability) =>
  href(locale, ...capabilitySlugs(capability));

/**
 * An entry's title: the verb's own copy, then the entity it acts on. Throws
 * when the catalog has none, so a register entry whose words were never
 * written stops the build instead of rendering an id as a heading.
 */
export const capabilityTitle = (locale: SiteLocale, capability: Capability) => {
  const { entityKey, action } = partsOf(capability);
  const verb = actionTitle(locale, entityKey, action);
  if (verb === undefined) {
    throw new Error(
      `docs-site: no ${locale} copy for ${capability.id} — add entity.${entityKey}.useCases to @r10c/business-ts-i18n`,
    );
  }
  const entity = entityLabel(
    locale,
    `${partsOf(capability).domain}:${entityKey}`,
  );
  // A flow that opens the entity is titled by the entity alone.
  return verb === entity ? verb : `${verb} · ${entity}`;
};

export const isCrossing = (permission: string) =>
  SERVICE_CROSSING_PERMISSIONS.some(granted =>
    permissionMatches(granted, permission as Permission),
  );

/** Every role whose grants cover the permission, wildcards included. */
export const rolesGranting = (permission: string) =>
  Object.entries(ROLE_PERMISSIONS)
    .filter(([, grants]) =>
      grants.some(granted =>
        permissionMatches(granted, permission as Permission),
      ),
    )
    .map(([role]) => role);

export const entriesOf = (domain: string) =>
  CAPABILITIES.filter(capability => partsOf(capability).domain === domain);

const statusLine = (locale: SiteLocale, capability: Capability) =>
  docsCopy(locale).statuses[capability.status];

/**
 * The map, then the same relations as a table: what a screen reader, a search
 * and a reader without the picture get. The image's address is not a file; the
 * page's `img` component draws it (`app/entity-map.tsx`).
 */
const mapSection = (locale: SiteLocale, capability: Capability) => {
  const words = docsCopy(locale).entityMap;
  const { edges } = entityMap(capability);
  return section(
    words.title,
    page(
      `![${words.description}](${MAP_SCHEME}${locale}/${capability.id})`,
      edges.length === 0
        ? words.noRelation
        : table(
            [words.from, words.member, words.relation, words.to, words.store],
            edges.map(({ from, member, kind, to }) => [
              code(from.entity),
              code(member),
              words.kinds[kind],
              to.part === undefined ? code(to.entity) : words.part,
              to.store === undefined ? words.noStore : code(to.store),
            ]),
          ),
    ).trimEnd(),
  );
};

const capabilityPage = (
  locale: SiteLocale,
  row: DomainRow,
  capability: Capability,
): ReferencePage => {
  const copy = docsCopy(locale);
  const words = copy.useCase;
  const { entityKey, action } = partsOf(capability);
  const oda = capability.oda ?? null;
  const roles = [...new Set(capability.permissions.flatMap(rolesGranting))];
  const verticals =
    capability.verticals === 'all'
      ? words.allVerticals
      : capability.verticals
          .map(vertical => copy.verticals[vertical])
          .join(', ');
  return {
    path: [`${entityKey}--${action}`],
    title: capabilityTitle(locale, capability),
    description: row.capability,
    file: `tools/capabilities (${capability.id})`,
    markdown: page(
      capability.status === 'implemented'
        ? ''
        : `:::note\n${words.notBuilt}\n:::`,
      facts([
        [words.id, code(capability.id)],
        [words.status, statusLine(locale, capability)],
        [words.domain, link(row.capability, href(locale, row.domain))],
        [
          words.oda,
          oda === null
            ? words.odaNone
            : `${code(oda)}${capability.odaOverride === undefined ? '' : ` — ${capability.odaOverride}`}`,
        ],
        [words.verticals, verticals],
      ]),
      section(
        words.entities,
        capability.entities
          .map(
            (reference, index) =>
              `- ${entityLabel(locale, reference)} ${code(reference)}${index === 0 ? ` — ${words.subject}` : ''}`,
          )
          .join('\n'),
      ),
      mapSection(locale, capability),
      section(
        words.permissions,
        capability.permissions
          .map(
            permission =>
              `- ${code(permission)}${isCrossing(permission) ? ` — ${words.crossing}` : ''}`,
          )
          .join('\n'),
      ),
      section(words.roles, list(roles.map(code), words.noRole)),
      section(
        words.screens,
        list(capability.screens.map(code), words.noScreen),
      ),
    ),
  };
};

const domainIndex = (locale: SiteLocale, row: DomainRow): ReferencePage => {
  const copy = docsCopy(locale);
  const words = copy.catalog;
  const hosting = storeOf(row.domain);
  const entries = entriesOf(row.domain);
  return {
    path: [],
    title: row.capability,
    description: row.odaAnalog === '—' ? copy.useCase.odaNone : row.odaAnalog,
    file: `tools/capabilities/src/domains.ts (${row.domain})`,
    markdown: page(
      facts([
        [words.kind, words.kinds.domain],
        [copy.useCase.domain, code(row.domain)],
        [words.package, code(`@r10c/${row.packageName}`)],
        [
          words.store,
          hosting === undefined
            ? words.none
            : link(
                hosting.store.name,
                href(locale, 'stores', hosting.store.name),
              ),
        ],
        [
          words.slice,
          hosting === undefined
            ? words.none
            : link(
                hosting.slice.name,
                href(locale, 'services', hosting.slice.name),
              ),
        ],
      ]),
      section(
        words.useCases,
        entries.length === 0
          ? words.none
          : table(
              [copy.useCase.count, copy.useCase.status],
              entries.map(capability => [
                link(
                  capabilityTitle(locale, capability),
                  capabilityHref(locale, capability),
                ),
                statusLine(locale, capability),
              ]),
            ),
      ),
    ),
  };
};

/**
 * One section per domain: its Domain page and one page per register entry in
 * it (ADR 0080 §7). Nothing here is written by hand — every word is the
 * register's, the domain table's or the catalog's.
 */
export const capabilitySources = (locale: SiteLocale): DocsSource[] =>
  DOMAINS.map(row =>
    referenceSource(row.domain, row.capability, () => [
      domainIndex(locale, row),
      ...entriesOf(row.domain).map(capability =>
        capabilityPage(locale, row, capability),
      ),
    ]),
  );
