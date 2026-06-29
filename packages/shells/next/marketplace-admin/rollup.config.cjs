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
      '@r10c/business-ts-product-configuration-management',
      '@r10c/entifix-react-integration',
      '@r10c/entifix-ts-business',
      '@r10c/entifix-ts-rest-client',
      '@r10c/implementation-product-configuration-management-react',
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
  }
);
