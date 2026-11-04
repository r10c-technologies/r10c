import nx from '@nx/eslint-plugin';

import baseConfig, { failureShapeConfig } from '../../../../eslint.config.mjs';

export default [
  ...baseConfig,
  ...nx.configs['flat/react'],
  failureShapeConfig,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    // Override or add rules here
    rules: {},
  },
  {
    settings: { react: { version: '19.0.0' } },
  },
  {
    ignores: ['**/out-tsc'],
  },
];
