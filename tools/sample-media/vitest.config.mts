import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/sample-media',
  root: import.meta.dirname,
  // A generator, not a library: `generate.ts` is a CLI whose only branches are
  // "write" and "check", and the spec compares every committed picture to
  // what `renderSampleMedia` draws for it.
  thresholds: false,
});
