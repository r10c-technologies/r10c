import baseConfig from '../../../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: ['{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}'],
          // Imported by @effect/opentelemetry 4.0.6, which declares it only as
          // an optional peer: pnpm resolves that peer for this package's copy
          // only when this package lists it, and nothing here imports it.
          ignoredDependencies: ['@opentelemetry/sdk-trace-web'],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
  {
    ignores: ['**/out-tsc'],
  },
];
