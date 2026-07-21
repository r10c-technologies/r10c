import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/entifix-react-controls',
  root: __dirname,
  environment: 'jsdom',
  // TODO(coverage): remove once this package reaches 100%.
  thresholds: false,
});
