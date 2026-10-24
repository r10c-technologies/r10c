import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/utils-react-ui',
  root: import.meta.dirname,
  environment: 'jsdom',
  // Stories are rendered by Storybook, whose build is the check on them.
  coverageExclude: ['**/*.stories.tsx'],
});
