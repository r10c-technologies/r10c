import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/i18n-catalog',
  root: __dirname,
  // Catalogs are data. Coverage would report on object literals and say
  // nothing; what guards this package is that the parity checker runs over it.
  thresholds: false,
});
