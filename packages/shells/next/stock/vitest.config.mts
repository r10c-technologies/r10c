import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/shells-next-stock',
  root: import.meta.dirname,
  setupFiles: ['./vitest.setup.i18n.ts'],
  environment: 'jsdom',
});
