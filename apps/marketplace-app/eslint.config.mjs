import nx from '@nx/eslint-plugin';
import nextConfig from 'eslint-config-next';
import coreWebVitalsConfig from 'eslint-config-next/core-web-vitals';

import baseConfig, {
  accessibleJsx,
  failureShapeConfig,
} from '../../eslint.config.mjs';

const config = [
  ...nextConfig,
  ...coreWebVitalsConfig,
  ...baseConfig,
  ...nx.configs['flat/react-typescript'],
  failureShapeConfig,
  accessibleJsx,
  {
    settings: { react: { version: '19.0.0' } },
  },
  {
    ignores: ['.next/**/*', '**/out-tsc'],
  },
];

export default config;
