import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/i18n-check',
  root: __dirname,
  // A check over the repository's own source, not logic worth covering. What
  // guards it is the same discipline `docs-check` uses: the scan pins the number
  // of emission sites it expects to find, so a regex that silently stops
  // matching fails loudly instead of passing vacuously.
  thresholds: false,
});
