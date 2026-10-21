import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/marketplace-app',
  root: import.meta.dirname,
  environment: 'jsdom',
  thresholds: false,
});
