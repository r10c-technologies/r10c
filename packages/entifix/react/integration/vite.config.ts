/// <reference types='vitest' />
import react from '@vitejs/plugin-react-swc';
import * as path from 'path';
import { defineConfig, type Plugin } from 'vite';
import dts from 'vite-plugin-dts';

/**
 * Fails the build the moment rollup inlines a CJS dependency into this ESM
 * bundle. Absorbing one makes rollup emit an interop helper that reads
 * `typeof require`, and the inlined module then calls it — which throws under a
 * Next app's server runtime (see the `external` note below).
 *
 * This has to live in the build, not in CI: every app route is currently
 * dynamic, so nothing prerenders and `nx build marketplace-admin-app` would go
 * green with the broken bundle sitting in `dist`.
 */
function failOnCjsInterop(): Plugin {
  return {
    name: 'r10c:fail-on-cjs-interop',
    generateBundle(_options, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== 'chunk' || !output.code.includes('typeof require'))
          continue;

        this.error(
          `${fileName} bundles a CommonJS dependency: the emitted interop ` +
            'helper reads `typeof require`, which throws against a Next ' +
            'server runtime. Add the offending package to `external`.',
        );
      }
    },
  };
}

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../../node_modules/.vite/packages/entifix/react/integration',
  plugins: [
    react(),
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(__dirname, 'tsconfig.lib.json'),
    }),
    failOnCjsInterop(),
  ],
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [],
  // },
  // Configuration for building your library.
  // See: https://vitejs.dev/guide/build.html#library-mode
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    lib: {
      // Could also be a dictionary or array of multiple entry points.
      entry: 'src/index.ts',
      name: '@r10c/entifix-react-integration',
      fileName: 'index',
      // Change this to the formats you want to support.
      // Don't forget to update your package.json as well.
      formats: ['es' as const],
    },
    rollupOptions: {
      // External packages that should not be bundled into your library.
      //
      // Any dependency that reaches `use-sync-external-store` MUST stay external —
      // react-i18next and the TanStack Form chain both do. Inlining one is what
      // breaks a consuming Next app's SSR/prerender, and the mechanism is ours,
      // not Turbopack's: when rollup absorbs a CJS module it emits an interop
      // helper (`typeof require < 'u' ? require : new Proxy(…)`) at the top of
      // this bundle, and the inlined shim then calls it as `require('react')`.
      // Turbopack's server runtime *does* define `require` — as a stub that
      // throws `dynamic usage of require is not supported`. Left external, the
      // bundle emits a plain `import` and Turbopack resolves the package itself,
      // which works. `serverExternalPackages`/`transpilePackages` cannot help:
      // by the time Next resolves anything the shim is already baked in here.
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'i18next',
        'react-i18next',
        '@tanstack/react-form',
        '@tanstack/form-core',
        '@tanstack/react-store',
        '@tanstack/store',
        'use-sync-external-store',
        'use-sync-external-store/shim/with-selector',
        '@r10c/entifix-ts-business',
        '@r10c/entifix-ts-core',
        '@r10c/entifix-ts-i18n',
        '@r10c/utils-ts-object',
      ],
      output: {
        banner: '"use client";',
      },
    },
  },
}));
