import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/shells-effect-service',
  root: import.meta.dirname,
  coverageExclude: [
    // Process bootstrap: dials config-service and hands the result to the
    // service's own `build`. It branches on nothing; every service's e2e boots
    // through it for real (ADR 0063).
    'src/fleet-service.ts',
  ],
});
