import * as path from 'node:path';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const workspaceRoot = import.meta.dirname;

/**
 * Vite 8 transforms TypeScript with oxc, which does not implement stage-3
 * decorators. Entity classes rely on them (`@entity()`/`@accessor()` register on
 * `MetaEntity`), so every project runs its sources through SWC instead, with the
 * same `decoratorVersion` + `keepClassNames` the library builds use.
 */
const swcTransform = () =>
  swc.vite({
    // Ignore the per-project `.swcrc` files so the test transform is defined in
    // exactly one place.
    swcrc: false,
    configFile: false,
    jsc: {
      target: 'es2022',
      parser: {
        syntax: 'typescript',
        decorators: true,
        dynamicImport: true,
        tsx: true,
      },
      transform: {
        decoratorVersion: '2022-03',
        react: { runtime: 'automatic', development: false },
      },
      keepClassNames: true,
      externalHelpers: false,
      loose: true,
    },
    module: { type: 'es6' },
    sourceMaps: true,
  });

/**
 * Files that are excluded from coverage everywhere. Keep this list short and
 * justified — every addition is a hole in the 100% gate.
 */
const sharedCoverageExclude = [
  // Pure re-export barrels. If a barrel grows logic, move the logic out rather
  // than adding an exception here.
  '**/index.ts',
  // Type-only modules compile to nothing executable.
  '**/*.types.ts',
  '**/*.d.ts',
  // Test material and configuration.
  '**/*.spec.{ts,tsx}',
  '**/*.test.{ts,tsx}',
  '**/*.config.{ts,mts,cts}',
  // Driver connection Layers: they open a real socket to Mongo/Redis/RabbitMQ
  // and contain no branching of their own. Covering them would mean either
  // mocking the driver module — which asserts nothing about our code — or
  // running infrastructure in the unit gate. They are exercised for real by
  // `entifix-ts-testing-integration` (Phase 4) instead.
  '**/mongo-database/mongo-database.ts',
  '**/redis-connection/redis-connection.ts',
  '**/amqp-connection/amqp-connection.ts',
];

/** Resolution conditions, with the workspace's source condition winning. */
const workspaceConditions = [
  '@r10c/source',
  'import',
  'module',
  'node',
  'default',
];

export interface EntifixTestOptions {
  /** Project name, as reported by the Vitest runner (`@r10c/…`). */
  name: string;
  /** The project directory — pass `__dirname`. */
  root: string;
  /** `jsdom` for anything rendering React. */
  environment?: 'node' | 'jsdom';
  setupFiles?: string[];
  /** Runs once before the whole suite — used by the service e2e projects. */
  globalSetup?: string[];
  /**
   * `false` disables the 100% thresholds — used by apps, which are covered by
   * their `*-e2e` projects rather than by unit tests.
   */
  thresholds?: boolean;
  /** Project-specific coverage exclusions, appended to the shared list. */
  coverageExclude?: string[];
}

export const defineEntifixTest = ({
  name,
  root,
  environment = 'node',
  setupFiles = [],
  globalSetup = [],
  thresholds = true,
  coverageExclude = [],
}: EntifixTestOptions) =>
  defineConfig(() => ({
    root,
    cacheDir: path.join(
      workspaceRoot,
      'node_modules/.vite',
      path.relative(workspaceRoot, root),
    ),
    // SWC owns the transform; oxc would otherwise run first and choke on
    // decorator syntax.
    oxc: false as const,
    plugins: [swcTransform()],
    resolve: {
      // Same condition `tsconfig.base.json` sets: cross-package imports resolve
      // to each package's `src/index.ts`, so tests never need a prior build and
      // a shared test library can depend on the packages that consume it.
      conditions: workspaceConditions,
    },
    // Vitest runs specs through Vite's SSR pipeline, which resolves with its own
    // condition list.
    ssr: { resolve: { conditions: workspaceConditions } },
    test: {
      name,
      watch: false,
      globals: true,
      environment,
      // Every jsdom project gets jest-dom matchers, RTL cleanup, and the
      // TextEncoder/TextDecoder polyfills `effect` needs.
      setupFiles:
        environment === 'jsdom'
          ? [path.join(workspaceRoot, 'vitest.setup.dom.ts'), ...setupFiles]
          : setupFiles,
      globalSetup,
      include: [
        '{src,specs,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      ],
      // Packages still awaiting their suite must not fail the run; the coverage
      // thresholds are what actually enforce the goal.
      passWithNoTests: true,
      server: {
        // Workspace packages must go through Vite's resolver rather than being
        // externalized to Node, which knows nothing of `@r10c/source`.
        deps: { inline: [/@r10c\//] },
      },
      reporters: ['default'],
      coverage: {
        provider: 'v8' as const,
        reportsDirectory: './test-output/vitest/coverage',
        reporter: ['text', 'html', 'lcov'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: [...sharedCoverageExclude, ...coverageExclude],
        thresholds: thresholds
          ? { lines: 100, branches: 100, functions: 100, statements: 100 }
          : undefined,
      },
    },
  }));
