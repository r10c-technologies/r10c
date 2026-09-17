import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/entifix-swap',
  root: __dirname,
  // The kit is plain `.mjs` run by a hook, an Nx runtime input and a person, and
  // the specs load it by path — so there is no transformed source for coverage
  // to instrument. What guards it is the spec driving every entry point against
  // a fake virtual store.
  thresholds: false,
});
