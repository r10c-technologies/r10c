import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/auth-app',
  root: __dirname,
  environment: 'jsdom',
  thresholds: false,
});
