import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/slices',
  root: __dirname,
  // Declarations, not logic: coverage would report on `export const … = {…}`
  // object literals and say nothing. What guards this project is that its own
  // assertions run, which the "finds the entity declarations it is meant to
  // check" test enforces from the inside.
  thresholds: false,
});
