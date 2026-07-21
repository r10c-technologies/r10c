import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/shells-next-marketplace',
  root: __dirname,
  environment: 'jsdom',
  // TODO(coverage): remove once this package reaches 100%.
  thresholds: false,
});
