import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/marketplace-admin-app',
  root: __dirname,
  environment: 'jsdom',
  thresholds: false,
});
