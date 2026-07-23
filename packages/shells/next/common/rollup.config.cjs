const { withNx } = require('@nx/rollup/with-nx');
const url = require('@rollup/plugin-url');
const svg = require('@svgr/rollup');

module.exports = withNx(
  {
    main: './src/index.ts',
    outputPath: './dist',
    tsConfig: './tsconfig.lib.json',
    compiler: 'swc',
    external: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      // Must resolve to the host app's copy: the App Router hooks read a React
      // context only the app's own module instance is mounted against.
      'next/navigation',
      'next/link',
      // A single MetaEntity registry / one React context for preferences.
      '@r10c/entifix-react-controls',
    ],
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
