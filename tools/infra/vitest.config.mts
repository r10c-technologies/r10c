import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/infra',
  root: import.meta.dirname,
  // A command, not a library: what its spec guards is the order of what it
  // runs and what it never runs (a destructive verb on the way down), and the
  // lab rehearsal is what proves the rest against a real cluster.
  thresholds: false,
});
