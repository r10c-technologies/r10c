import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/shells-effect-service',
  root: __dirname,
  coverageExclude: [
    // Process bootstrap: binds a port and hands control to `NodeRuntime.runMain`,
    // which never returns and installs signal handlers. It branches on nothing,
    // so covering it would mean booting a server per test to assert the
    // framework works. The services' own `*-e2e` projects exercise it for real.
    'src/make-service.ts',
  ],
});
