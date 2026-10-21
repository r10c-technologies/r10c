import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/payment-service',
  root: import.meta.dirname,
  thresholds: false,
});
