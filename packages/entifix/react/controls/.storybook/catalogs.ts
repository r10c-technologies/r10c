import { defineCatalogs } from '@entifix/i18n';

import { controlsCatalogs } from '../src/i18n/catalog';

/**
 * Storybook renders the controls on their own, so the only catalog it needs is
 * the one this package ships. An entity's `labelKey` has no story.
 */
defineCatalogs({
  resources: controlsCatalogs,
  namespaces: ['controls'],
  defaultNS: 'controls',
});
