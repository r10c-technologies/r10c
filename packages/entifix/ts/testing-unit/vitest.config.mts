import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@entifix/testing-unit',
  root: __dirname,
  environment: 'jsdom',
});
