import baseConfig, { sliceShellConfig } from '../../../../eslint.config.mjs';

export default [
  ...baseConfig,
  sliceShellConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: ['{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}'],
          // `@effect/opentelemetry` is never imported here, but the declared
          // type of `makeAppLayer` names its `Resource` (the observability layer
          // is part of what the composition provides), and a declaration can
          // only name a package its own project resolves. The trace-web package
          // is that one's optional peer, resolved for this copy only when listed.
          ignoredDependencies: [
            '@effect/opentelemetry',
            '@opentelemetry/sdk-trace-web',
          ],
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
