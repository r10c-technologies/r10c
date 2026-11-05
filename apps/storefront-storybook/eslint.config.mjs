import nx from '@nx/eslint-plugin';

import baseConfig, {
  accessibleJsx,
  failureShapeConfig,
} from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  ...nx.configs['flat/react'],
  failureShapeConfig,
  accessibleJsx,
  {
    settings: { react: { version: '19.0.0' } },
  },
  {
    ignores: ['**/storybook-static'],
  },
];
