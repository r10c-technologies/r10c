import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/docs-site',
  root: import.meta.dirname,
  environment: 'node',
  thresholds: false,
});
