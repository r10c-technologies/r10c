import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/shells-next-system-management',
  root: __dirname,
  environment: 'jsdom',
  setupFiles: ['./vitest.setup.i18n.ts'],
});
