import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/entifix-react-integration',
  root: __dirname,
  environment: 'jsdom',
});
