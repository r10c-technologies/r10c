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
    // Resolve @r10c/* workspace libs to their `src/index.ts` (stage-3 compile,
    // same mode entifix authored in — no decorator recompile conflict).
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
      // Bundle @r10c/* (incl. the effect-service base) from src; keep the Effect
      // runtime + platform + tslib external (resolved from node_modules).
      externalDependencies: [
        'effect',
        '@effect/platform',
        '@effect/platform-node',
        'tslib',
      ],
    }),
  ],
};
