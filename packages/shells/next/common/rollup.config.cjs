const { withNx } = require('@nx/rollup/with-nx');
const url = require('@rollup/plugin-url');
const svg = require('@svgr/rollup');

const external = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  // Must resolve to the host app's copy: the App Router hooks read a React
  // context only the app's own module instance is mounted against.
  'next/navigation',
  'next/link',
  'next/server',
  // A single MetaEntity registry / one React context for preferences.
  '@r10c/entifix-react-controls',
];

/**
 * The client bundle. Everything reachable from `./src/index.ts` is stamped
 * `"use client"` by the banner below, because rollup emits it as one file and a
 * per-module directive would not survive the merge.
 */
const client = withNx(
  {
    main: './src/index.ts',
    outputPath: './dist',
    tsConfig: './tsconfig.lib.json',
    compiler: 'swc',
    external,
    format: ['esm'],
    assets: [{ input: '.', output: '.', glob: 'README.md' }],
  },
  {
    // Provide additional rollup configuration here. See: https://rollupjs.org/configuration-options
    output: {
      banner: '"use client";',
    },
    plugins: [
      svg({
        svgo: false,
        titleProp: true,
        ref: true,
      }),
      url({
        limit: 10000, // 10kB
      }),
    ],
  },
);

/**
 * The `@r10c/shells-next-common/server` bundle — route handlers and anything
 * else that must stay on the server, emitted **without** the `"use client"`
 * banner. It gets its own entry precisely because that banner is all-or-nothing
 * per bundle: a route handler pulled in through the client entry would become a
 * client reference and its `next/server` imports would fail at build time.
 *
 * Mirrors the `./server` subpath `@r10c/shells-next-i18n` already publishes.
 * `deleteOutputPath` is off so this second pass keeps the client output.
 */
const server = withNx(
  {
    main: './src/server.ts',
    outputPath: './dist',
    tsConfig: './tsconfig.lib.json',
    compiler: 'swc',
    external,
    format: ['esm'],
    deleteOutputPath: false,
    generatePackageJson: false,
  },
  {},
);

module.exports = [client, server];
