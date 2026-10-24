import nx from '@nx/eslint-plugin';

import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  ...nx.configs['flat/react'],
  {
    settings: { react: { version: '19.0.0' } },
  },
  {
    ignores: ['**/storybook-static'],
  },
];
