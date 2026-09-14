/**
 * Registers this package's `shell` catalog with the controls package's
 * no-provider fallback, for every spec here.
 *
 * ⚠️ **A setup file because a spec imports a component, not the barrel.**
 * Registration happens when `src/lib/i18n/catalog` is loaded, which a consumer
 * of the package gets through `src/index.ts` — but a spec that imports
 * `account-menu.tsx` directly never reaches it, and would assert against raw
 * keys and pass for the wrong reason.
 */
import './src/lib/i18n/catalog';
// And an `entity` fixture, because that namespace is the host's.
import './src/lib/i18n/spec-catalog';

// And the i18next binding's own catalogs, for the specs that mount the real
// `I18nProvider` rather than relying on the no-provider fallback.
import { defineCatalogs } from '@entifix/i18n';
import { controlsCatalogs } from '@entifix/react-controls';

import { shellCatalogs } from './src/lib/i18n/catalog';

defineCatalogs({
  resources: {
    es: { ...controlsCatalogs.es, ...shellCatalogs.es },
    en: { ...controlsCatalogs.en, ...shellCatalogs.en },
  },
  namespaces: ['controls', 'shell'],
  defaultNS: 'controls',
});
