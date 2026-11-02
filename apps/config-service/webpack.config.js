const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

const { externalPackages } = require('../../tools/webpack-externals.cjs');

// Bundle @r10c/* from src; keep third-party runtime deps external.
const EXTERNAL_DEPENDENCIES = [
  'effect',
  '@effect/opentelemetry',
  '@opentelemetry/api',
  '@opentelemetry/context-async-hooks',
  '@opentelemetry/exporter-metrics-otlp-http',
  '@opentelemetry/exporter-trace-otlp-http',
  '@opentelemetry/resources',
  '@opentelemetry/sdk-metrics',
  '@opentelemetry/sdk-trace-base',
  '@opentelemetry/sdk-trace-node',
  '@opentelemetry/semantic-conventions',
  '@effect/platform',
  '@effect/platform-node',
  '@effect/sql',
  '@effect/sql-pg',
  'dotenv',
  'tslib',
];

module.exports = {
  // A subpath too: Nx's list matches exactly, and `effect/http` bundled beside
  // an external `effect` is two copies of effect in one process.
  externals: [externalPackages(EXTERNAL_DEPENDENCIES)],
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  resolve: {
    conditionNames: ['@r10c/source', 'import', 'node', 'require', 'default'],
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      mergeExternals: true,
      compiler: 'swc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMaps: true,
      externalDependencies: EXTERNAL_DEPENDENCIES,
    }),
  ],
};
