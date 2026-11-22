import '@r10c/business-ts-i18n/locales';

import { defineCatalogs } from '@entifix/i18n';
import {
  controlsCatalogs,
  type ControlsResources,
} from '@entifix/react-controls';
// Load-bearing though it imports nothing: a `declare module` resolves from this
// file's directory, so `i18next` must be a dependency of this application.
import type {} from 'i18next';

/**
 * The site's chrome needs one namespace, the controls catalog, whose `docs`
 * block holds every string fumadocs shows. Its pages are generated on the
 * server from r10c's own catalogs (`src/content/copy.ts`) and never go through
 * i18next. Imported from both the layouts and the providers, because a Next
 * app's server and client bundles share no module state; the locales
 * themselves are r10c's, declared by the import above.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'controls';
    resources: ControlsResources;
  }
}

defineCatalogs({
  resources: { en: controlsCatalogs.en, es: controlsCatalogs.es },
  namespaces: ['controls'],
  defaultNS: 'controls',
});
