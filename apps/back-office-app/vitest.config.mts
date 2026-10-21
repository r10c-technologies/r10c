import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/back-office-app',
  root: import.meta.dirname,
  environment: 'jsdom',
  thresholds: false,
});
