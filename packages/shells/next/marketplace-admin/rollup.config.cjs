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
      // Must resolve to the host app's copy: the App Router's hooks read a React
      // context that only the app's own module instance is mounted against.
      // Bundling a second copy makes useRouter throw "expected app router to be
      // mounted".
      'next/navigation',
      '@r10c/business-ts-product-configuration-management',
      '@r10c/entifix-react-integration',
      '@r10c/entifix-ts-business',
      '@r10c/entifix-ts-core',
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
  },
);
