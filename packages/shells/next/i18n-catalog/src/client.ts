// r10c's locales, declared before anything asks about one (entifix#35). The
// definitions only: no catalog comes with them.
import '@r10c/business-ts-i18n/locales';

import type { Locale } from '@entifix/core';
import { defineCatalogs, type LocaleCatalogs } from '@entifix/i18n';

import { DEFAULT_NS, NAMESPACES } from './namespaces.js';

/** Every locale installed so far in this module graph, by locale. */
const installed: Record<string, LocaleCatalogs> = {};

/**
 * Installs the one locale's client catalog a server layout handed its client
 * providers (#566).
 *
 * ⚠️ **It imports no copy, and that is the point.** Importing `.` from a client
 * component bundles every namespace in every locale into every page — the
 * back office's copy included on the storefront — and that chunk grew with
 * each milestone. The server already holds every catalog; it cuts what the
 * client renders with `clientCatalog` and passes it down as a prop.
 *
 * It runs on the server too: client components are server-rendered in a
 * module graph of their own, apart from the server components' (which the
 * layout's import of `.` fills), and they need their copy there as well.
 * Locales **accumulate** rather than replace, so two requests rendering in two
 * languages at once never take each other's catalog away; a locale's subset is
 * fixed for a build, so the first install of it is the only one.
 */
export const installClientCatalog = (
  locale: Locale,
  catalog: LocaleCatalogs,
): void => {
  if (installed[locale] !== undefined) return;
  installed[locale] = catalog;
  defineCatalogs({
    resources: { ...installed },
    namespaces: NAMESPACES,
    defaultNS: DEFAULT_NS,
  });
};
