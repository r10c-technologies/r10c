import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/shells-next-common',
  root: __dirname,
  environment: 'jsdom',
});
