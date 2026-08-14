import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/docs-check',
  root: __dirname,
  // Assertions about prose, not logic worth covering. What guards this project
  // is that its own matchers still match: every regex-driven check pins the
  // number of things it expects to find, so one that silently stops matching
  // fails loudly instead of passing vacuously.
  thresholds: false,
});
