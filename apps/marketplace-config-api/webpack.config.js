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
    // Resolve workspace libraries (e.g. @r10c/entifix-ts-core) to their TS source
    // so they are bundled here, matching how the Next apps consume them in dev and
    // avoiding the libraries' published ESM output at runtime.
    conditionNames: ['@r10c/source', 'import', 'node', 'require', 'default'],
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMaps: true,
      // Bundle workspace libraries into the output; only externalize true
      // third-party runtime deps (express, dotenv) which generatePackageJson lists.
      externalDependencies: ['express', 'dotenv'],
    }),
  ],
};
