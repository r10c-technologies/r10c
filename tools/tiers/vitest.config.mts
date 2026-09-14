import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/tiers',
  root: __dirname,
  // Declarations, not logic — same reasoning as `@r10c/slices`. What guards
  // this project is that its own assertions still run, which the pinned
  // package count enforces from the inside.
  thresholds: false,
});
