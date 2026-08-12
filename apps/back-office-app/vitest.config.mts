import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/back-office-app',
  root: __dirname,
  environment: 'jsdom',
  thresholds: false,
});
