import nx from '@nx/eslint-plugin';
import nextConfig from 'eslint-config-next';
import coreWebVitalsConfig from 'eslint-config-next/core-web-vitals';

import baseConfig, { accessibleJsx } from '../../eslint.config.mjs';

const config = [
  ...nextConfig,
  ...coreWebVitalsConfig,
  ...baseConfig,
  ...nx.configs['flat/react-typescript'],
  {
    settings: { react: { version: '19.0.0' } },
  },
  {
    ignores: ['.next/**/*', '**/out-tsc', 'out/**/*', 'next-env.d.ts'],
  },
  // After the React and Next presets, whose warn-level subsets would win.
  accessibleJsx,
];

export default config;
