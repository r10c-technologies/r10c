import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/shells-next-settlement',
  root: __dirname,
  environment: 'jsdom',
});
