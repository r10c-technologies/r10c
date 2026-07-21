import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/entifix-ts-testing-unit',
  root: __dirname,
  environment: 'jsdom',
});
