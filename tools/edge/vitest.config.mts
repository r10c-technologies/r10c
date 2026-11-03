import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/edge',
  root: import.meta.dirname,
  // A generator, not a library: `generate.ts` is a CLI whose only branches are
  // "write" and "check", and what guards the rendered files is
  // `@r10c/docs-check` comparing them to `renderEdge` on every CI run.
  thresholds: false,
});
