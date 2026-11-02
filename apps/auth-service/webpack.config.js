const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

const { externalPackages } = require('../../tools/webpack-externals.cjs');

// Bundle every @r10c/* workspace lib from src (via conditionNames below);
// keep only genuine third-party runtime deps external. Note: NO reflect-
// metadata, NO @nestjs/*, NO rxjs — this shell has no Nest footprint.
// `tslib` carries the stage-3 decorator helpers (`__esDecorate` /
// `__runInitializers`) the entity transform emits; externalize it so Node
// loads it as real CJS instead of webpack's broken ESM-interop wrapper.
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
  'mongodb',
  // ioredis backs the Redis session store; keep it external (native-ish
  // deps) rather than bundled. `jose` is pure JS and bundles.
  'ioredis',
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
    // Resolve workspace libraries to their `src/index.ts` via `@r10c/source`.
    // Because THIS shell compiles with stage-3 decorators (see .swcrc), the
    // bundler recompiles entity source (`@entity`/`@accessor`) in the SAME
    // decorator mode entifix authored it in — so entities load natively with
    // no EntifixBuildError and no `/contracts` firewall. That is the whole
    // point of the spike vs the Nest build.
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
