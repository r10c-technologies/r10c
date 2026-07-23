import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/entifix-react-controls',
  root: __dirname,
  environment: 'jsdom',
  // Storybook material lives beside the components but is not unit-tested — it
  // is exercised by the story build (`nx build-storybook`), not the 100% gate.
  coverageExclude: ['**/*.stories.tsx', '**/_demo.tsx'],
});
