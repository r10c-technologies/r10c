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
      compiler: 'swc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMaps: true,
      // Bundle every @r10c/* workspace lib from src (via conditionNames above);
      // keep only genuine third-party runtime deps external. Note: NO reflect-
      // metadata, NO @nestjs/*, NO rxjs — this shell has no Nest footprint.
      // `tslib` carries the stage-3 decorator helpers (`__esDecorate` /
      // `__runInitializers`) the entity transform emits; externalize it so Node
      // loads it as real CJS instead of webpack's broken ESM-interop wrapper.
      externalDependencies: [
        'effect',
        '@effect/platform',
        '@effect/platform-node',
        'mongodb',
        'tslib',
      ],
    }),
  ],
};
