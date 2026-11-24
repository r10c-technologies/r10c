import {
  createDocsSite,
  type DocsSite,
  referenceKind,
} from '@entifix/docs-engine';
import { CAPABILITIES } from '@r10c/capabilities';

import { apiSource } from './content/api';
import { audienceSource } from './content/audiences';
import { servicesSource, STORES, storesSource } from './content/catalog';
import { SITE_LOCALES, type SiteLocale } from './content/copy';
import { flowsSource } from './content/flows';
import { GUIDES_LOCALE, verticalGuidesSource } from './content/guides';
import { href } from './content/markdown';
import {
  capabilityHref,
  capabilitySources,
  capabilityTitle,
} from './content/use-cases';

/**
 * One site per language. The engine has no locale of its own, so each tree is
 * its own site with its own sidebar, over the same registers: `/es/…` reads
 * the Spanish catalog and `/en/…` the English one, and nothing else differs.
 */
const build = (locale: SiteLocale): DocsSite =>
  createDocsSite({
    baseUrl: `/${locale}`,
    sources: [
      audienceSource(locale),
      // The guides live in the Spanish tree only (Q26); the English one
      // links to them from its home and its merchant door.
      ...(locale === GUIDES_LOCALE ? [verticalGuidesSource()] : []),
      ...capabilitySources(locale),
      flowsSource(locale),
      servicesSource(locale),
      apiSource(locale),
      storesSource(locale),
    ],
    // What a guide may cite (#655): a use case by its id, a store by its name.
    references: {
      'use-case': referenceKind(
        CAPABILITIES.map(capability => capability.id),
        id => {
          const capability = CAPABILITIES.find(entry => entry.id === id);
          return capability === undefined
            ? href(locale)
            : capabilityHref(locale, capability);
        },
        id => {
          const capability = CAPABILITIES.find(entry => entry.id === id);
          return capability === undefined
            ? id
            : capabilityTitle(locale, capability);
        },
      ),
      store: referenceKind(
        STORES.map(({ store }) => store.name),
        name => href(locale, 'stores', name),
      ),
    },
  });

const SITES = new Map<SiteLocale, DocsSite>();

export const siteFor = (locale: SiteLocale): DocsSite => {
  let site = SITES.get(locale);
  if (site === undefined) {
    site = build(locale);
    SITES.set(locale, site);
  }
  return site;
};

/** Every page of both trees, for `generateStaticParams`. */
export const allParams = () =>
  SITE_LOCALES.flatMap(lang =>
    siteFor(lang)
      .params()
      .map(param => ({ lang, slug: param.slug })),
  );
