import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/conventions',
  root: __dirname,
  // Assertions about the repository's own conventions, not logic worth
  // covering. What guards this project is the same thing that guards
  // `@r10c/docs-check`: every scan pins the number of things it expects to
  // find, so a matcher that silently stops matching fails loudly instead of
  // passing vacuously.
  thresholds: false,
});
