import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/business-ts-i18n',
  root: __dirname,
  // Catalogs are data. Coverage would report on object literals and say
  // nothing; what guards this package is `tools/check-i18n.mjs` and
  // `@r10c/i18n-check`, which read it.
  thresholds: false,
});
