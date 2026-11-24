import type { DocsSource, ReferencePage } from '@entifix/docs-engine';
import { referenceSource } from '@entifix/docs-engine';
import {
  CAPABILITIES,
  type Capability,
  DOMAINS,
  STATUSES,
  VERTICALS,
} from '@r10c/capabilities';

import { docsCopy, type SiteLocale } from './copy';
import { GUIDES_FOLDER, GUIDES_LOCALE } from './guides';
import { code, href, link, list, page, section, table } from './markdown';
import {
  capabilityHref,
  capabilityTitle,
  entriesOf,
  isCrossing,
  rolesGranting,
} from './use-cases';

export const AUDIENCES = [
  'developer',
  'operator',
  'merchant',
  'evaluator',
] as const;
export type Audience = (typeof AUDIENCES)[number];

/** The folder the four doors and the home live in. */
export const AUDIENCE_FOLDER = 'start';

const titled = (locale: SiteLocale, capability: Capability) =>
  link(capabilityTitle(locale, capability), capabilityHref(locale, capability));

const byDomain = (
  locale: SiteLocale,
  header: readonly string[],
  row: (capability: Capability) => readonly string[],
  keep: (capability: Capability) => boolean = () => true,
) =>
  DOMAINS.flatMap(domain => {
    const entries = entriesOf(domain.domain).filter(keep);
    if (entries.length === 0) return [];
    return [
      section(
        domain.capability,
        table(
          header,
          entries.map(capability => [
            titled(locale, capability),
            ...row(capability),
          ]),
        ),
      ),
    ];
  });

/** Permissions with crossings marked, for those who build and run the fleet. */
const developer = (locale: SiteLocale) => {
  const words = docsCopy(locale).useCase;
  return byDomain(
    locale,
    [words.count, words.id, words.permissions],
    capability => [
      code(capability.id),
      capability.permissions
        .map(
          permission =>
            `${code(permission)}${isCrossing(permission) ? ` (${words.crossing})` : ''}`,
        )
        .join(', '),
    ],
  );
};

/** Who is granted what: the roles behind each permission, crossings apart. */
const operator = (locale: SiteLocale) => {
  const words = docsCopy(locale).useCase;
  return byDomain(
    locale,
    [words.count, words.roles, words.crossings],
    capability => [
      list(
        [...new Set(capability.permissions.flatMap(rolesGranting))].map(code),
        words.noRole,
      ),
      list(capability.permissions.filter(isCrossing).map(code), '—'),
    ],
  );
};

/**
 * The guides, one per vertical, always in the Spanish tree (Q26). Only a
 * tree in another language says so — a Spanish reader is already home.
 */
const guideLinks = (locale: SiteLocale) => {
  const copy = docsCopy(locale);
  const note = locale === GUIDES_LOCALE ? '' : ` ${copy.guides.inSpanish}`;
  return section(
    copy.guides.title,
    `${copy.guides.description}${note}\n\n${VERTICALS.map(
      vertical =>
        `- ${link(copy.verticals[vertical], href(GUIDES_LOCALE, GUIDES_FOLDER, vertical))}`,
    ).join('\n')}`,
  );
};

/** What a seller can do and where, with what does not exist yet said plainly. */
const merchant = (locale: SiteLocale) => [
  guideLinks(locale),
  ...merchantByDomain(locale),
];

const merchantByDomain = (locale: SiteLocale) => {
  const copy = docsCopy(locale);
  const words = copy.useCase;
  return byDomain(
    locale,
    [words.count, words.status, words.screens, words.verticals],
    capability => [
      copy.statuses[capability.status],
      list(capability.screens.map(code), words.noScreen),
      capability.verticals === 'all'
        ? words.allVerticals
        : capability.verticals
            .map(vertical => copy.verticals[vertical])
            .join(', '),
    ],
  );
};

/** Built against not built, counted from the register. */
const evaluator = (locale: SiteLocale) => {
  const copy = docsCopy(locale);
  return STATUSES.map(status => {
    const entries = CAPABILITIES.filter(
      capability => capability.status === status,
    );
    return section(
      `${copy.statuses[status]} (${entries.length})`,
      entries.length === 0
        ? copy.catalog.none
        : entries
            .map(capability => `- ${titled(locale, capability)}`)
            .join('\n'),
    );
  });
};

const BODIES: Record<Audience, (locale: SiteLocale) => string[]> = {
  developer,
  operator,
  merchant,
  evaluator,
};

/** The home: four doors, and the storefront's components beside them. */
const home = (locale: SiteLocale): ReferencePage => {
  const copy = docsCopy(locale);
  return {
    path: [],
    title: copy.home.title,
    description: copy.home.description,
    file: 'apps/docs-site/src/content/audiences.ts (home)',
    markdown: page(
      copy.home.intro,
      AUDIENCES.map(
        audience =>
          `- ${link(copy.audiences[audience].title, href(locale, AUDIENCE_FOLDER, audience))} — ${copy.audiences[audience].description}`,
      ).join('\n'),
      guideLinks(locale),
      section(
        copy.catalog.title,
        `- ${link(copy.flows.title, href(locale, 'flows'))} — ${copy.flows.description}\n- ${link(copy.catalog.title, href(locale, 'services'))} — ${copy.catalog.description}\n- ${link(copy.catalog.storesTitle, href(locale, 'stores'))} — ${copy.catalog.storesDescription}`,
      ),
      // `/ui/` is outside both locale trees: one Storybook serves either.
      section(
        copy.home.storybook,
        `${link(copy.home.storybook, '/ui/')} — ${copy.home.storybookNote}`,
      ),
    ),
  };
};

/**
 * The four entry points (Q24): the same register entries, each filtered and
 * columned for one reader (ADR 0080 §7).
 */
export const audienceSource = (locale: SiteLocale): DocsSource =>
  referenceSource(AUDIENCE_FOLDER, docsCopy(locale).audiences.title, () => [
    home(locale),
    ...AUDIENCES.map(audience => ({
      path: [audience],
      title: docsCopy(locale).audiences[audience].title,
      description: docsCopy(locale).audiences[audience].description,
      file: `apps/docs-site/src/content/audiences.ts (${audience})`,
      markdown: page(...BODIES[audience](locale)),
    })),
  ]);
