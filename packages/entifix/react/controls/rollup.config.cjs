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
      '@headlessui/react',
      'class-variance-authority',
      // Runtime values are imported from these (describeEntityColumns,
      // EntityLink, Effect/Context), so they must not be inlined into the
      // bundle — a second copy of entifix-ts-core would carry its own
      // MetaEntity registry and see no decorated entities.
      '@r10c/entifix-ts-core',
      'effect',
    ],
    format: ['esm'],
    assets: [{ input: '.', output: '.', glob: 'README.md' }],
  },
  {
    // Provide additional rollup configuration here. See: https://rollupjs.org/configuration-options
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
