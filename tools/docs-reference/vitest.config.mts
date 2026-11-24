import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/docs-reference',
  root: import.meta.dirname,
  // `generate.ts` is a CLI that writes what the two modules return; the spec
  // covers the modules.
  coverageExclude: ['src/generate.ts'],
});
