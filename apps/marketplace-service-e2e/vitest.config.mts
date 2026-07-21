import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/marketplace-service-e2e',
  root: __dirname,
  thresholds: false,
  globalSetup: ['./src/support/global-setup.ts'],
  setupFiles: ['./src/support/test-setup.ts'],
});
