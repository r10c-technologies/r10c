import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@entifix/next-shell',
  root: __dirname,
  environment: 'jsdom',
  setupFiles: ['./vitest.setup.i18n.ts'],
});
