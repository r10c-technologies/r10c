import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/realtime-service',
  root: import.meta.dirname,
  thresholds: false,
});
