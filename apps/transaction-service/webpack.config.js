const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
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
      compiler: 'swc',
      main: './src/main.ts',
      // The runner-only replica of the flow engine (ADR 0066), its own process.
      additionalEntryPoints: [
        { entryName: 'runner', entryPath: './src/runner.ts' },
      ],
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMaps: true,
      externalDependencies: [
        'effect',
        '@effect/opentelemetry',
        '@effect/platform',
        '@effect/platform-node',
        '@effect/sql-pg',
        '@opentelemetry/api',
        '@opentelemetry/context-async-hooks',
        '@opentelemetry/exporter-metrics-otlp-http',
        '@opentelemetry/exporter-trace-otlp-http',
        '@opentelemetry/resources',
        '@opentelemetry/sdk-metrics',
        '@opentelemetry/sdk-trace-base',
        '@opentelemetry/sdk-trace-node',
        '@opentelemetry/semantic-conventions',
        'mongodb',
        'tslib',
      ],
    }),
  ],
};
