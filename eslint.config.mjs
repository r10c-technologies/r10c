import nx from '@nx/eslint-plugin';
import react from 'eslint-plugin-react';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

import { r10cPlugin } from './tools/eslint-rules/no-foreign-app-namespace.mjs';

// ---------------------------------------------------------------------------
// Module-boundary hierarchy (enforced by @nx/enforce-module-boundaries).
//
// Every project is tagged in its package.json `nx.tags` across three dimensions:
//   layer:*    app › shell › implementation › business › entifix › utils
//              (a project may only depend DOWNWARD)
//   scope:*    a domain scope (marketplace / marketplace-admin / auth /
//              transaction / config) may only depend on itself or `scope:shared`;
//              `scope:shared` is the reusable core and is dependable by anyone.
//   entifix:*  internal ordering INSIDE the entifix layer:
//              core ‹ contract ‹ {tooling, style} ‹ transactions ‹ client ‹ react
//   business:* internal ordering INSIDE the business layer: policy ‹ domain
//              (a domain may use the shared authorization vocabulary; it may
//              never import another domain)
//   shell:*    internal ordering INSIDE the shell layer: base ‹ domain
//              (a domain shell mounts onto the framework shell; base shells
//              stay independent of each other)
//   host:*     what kind of runtime host an app is — `next` or `effect`. Paired
//              with `runtime:datastore` on the datastore clients: a Next app may
//              not reach a database driver at all.
//   type:*     testing/e2e helpers (relaxed — see specConstraints).
//
// The rule ANDs every constraint whose `sourceTag` a project carries, so the
// dimensions compose. See docs/DEVELOPING.md → "Module boundaries".
// ---------------------------------------------------------------------------

const layerConstraints = [
  {
    sourceTag: 'layer:app',
    onlyDependOnLibsWithTags: [
      'layer:shell',
      'layer:implementation',
      'layer:business',
      'layer:entifix',
      'layer:utils',
    ],
  },
  {
    sourceTag: 'layer:shell',
    onlyDependOnLibsWithTags: [
      // Same-layer edges are allowed but ORDERED by `shell:*` below, exactly as
      // `layer:business` is ordered by `business:*`. Without that second
      // dimension this line would let any shell import any other.
      'layer:shell',
      'layer:implementation',
      'layer:business',
      'layer:entifix',
      'layer:utils',
    ],
  },
  {
    sourceTag: 'layer:implementation',
    onlyDependOnLibsWithTags: [
      'layer:business',
      'layer:entifix',
      'layer:utils',
    ],
  },
  {
    sourceTag: 'layer:business',
    onlyDependOnLibsWithTags: [
      // Same-layer edges are allowed but ORDERED by `business:*` below, exactly
      // as `layer:entifix` is ordered by `entifix:*`. Without that second
      // dimension this line would let any domain import any other.
      'layer:business',
      'layer:entifix',
      'layer:utils',
    ],
  },
  {
    sourceTag: 'layer:entifix',
    onlyDependOnLibsWithTags: ['layer:entifix', 'layer:utils'],
  },
  { sourceTag: 'layer:utils', onlyDependOnLibsWithTags: ['layer:utils'] },
];

const scopeConstraints = [
  {
    sourceTag: 'scope:marketplace',
    onlyDependOnLibsWithTags: ['scope:marketplace', 'scope:shared'],
  },
  {
    sourceTag: 'scope:marketplace-admin',
    onlyDependOnLibsWithTags: ['scope:marketplace-admin', 'scope:shared'],
  },
  {
    sourceTag: 'scope:auth',
    onlyDependOnLibsWithTags: ['scope:auth', 'scope:shared'],
  },
  {
    sourceTag: 'scope:transaction',
    onlyDependOnLibsWithTags: ['scope:transaction', 'scope:shared'],
  },
  {
    sourceTag: 'scope:config',
    onlyDependOnLibsWithTags: ['scope:config', 'scope:shared'],
  },
];

const entifixConstraints = [
  { sourceTag: 'entifix:core', onlyDependOnLibsWithTags: ['layer:utils'] },
  {
    sourceTag: 'entifix:contract',
    onlyDependOnLibsWithTags: ['entifix:core', 'layer:utils'],
  },
  { sourceTag: 'entifix:tooling', onlyDependOnLibsWithTags: ['layer:utils'] },
  { sourceTag: 'entifix:style', onlyDependOnLibsWithTags: [] },
  {
    sourceTag: 'entifix:transactions',
    onlyDependOnLibsWithTags: [
      'entifix:core',
      'entifix:contract',
      'entifix:tooling',
      'layer:utils',
    ],
  },
  {
    sourceTag: 'entifix:client',
    onlyDependOnLibsWithTags: [
      'entifix:core',
      'entifix:contract',
      'entifix:tooling',
      'entifix:transactions',
      'layer:utils',
    ],
  },
  {
    sourceTag: 'entifix:react',
    onlyDependOnLibsWithTags: [
      'entifix:core',
      'entifix:contract',
      'entifix:client',
      'entifix:transactions',
      'entifix:tooling',
      'entifix:style',
      'layer:utils',
    ],
  },
];

// Internal ordering INSIDE the business layer, mirroring `entifix:*`.
// `policy` is the authorization vocabulary every domain may express itself in;
// a `domain` may reach down to it but never sideways to another domain.
const businessConstraints = [
  {
    sourceTag: 'business:policy',
    onlyDependOnLibsWithTags: ['layer:entifix', 'layer:utils'],
  },
  {
    sourceTag: 'business:domain',
    onlyDependOnLibsWithTags: [
      'business:policy',
      'layer:entifix',
      'layer:utils',
    ],
  },
];

// Internal ordering INSIDE the shell layer, mirroring `business:*`.
// `base` is the reusable framework shell (the effect-service base, the Next
// common/i18n shells); a `domain` shell mounts one domain onto it. Without this
// dimension `layer:shell` forbids same-layer edges outright, and a per-domain
// API module cannot reach `requirePermission`/`makeServerLayer` at all.
const shellConstraints = [
  {
    sourceTag: 'shell:base',
    onlyDependOnLibsWithTags: [
      'layer:implementation',
      'layer:business',
      'layer:entifix',
      'layer:utils',
    ],
  },
  {
    sourceTag: 'shell:domain',
    onlyDependOnLibsWithTags: [
      'shell:base',
      'layer:implementation',
      'layer:business',
      'layer:entifix',
      'layer:utils',
    ],
  },
];

// Storage ownership, enforced. Apps sit at the top layer, so the `layer:*`
// dimension alone would happily let a Next app import `makeMongoRepository` and
// write a database directly — the one hole in "one writer per database"
// (docs/adr/0008). A Next backend is composition (cookies, proxying, RSC
// aggregation), never data access; only a `host:effect` service binds a
// repository to a datastore client.
const hostConstraints = [
  {
    sourceTag: 'host:next',
    notDependOnLibsWithTags: ['runtime:datastore'],
  },
];

// Strict constraints for source files. The trailing `*` catch-all lets any
// untagged project (e.g. testing/e2e) and external deps still resolve.
const sourceConstraints = [
  ...layerConstraints,
  ...scopeConstraints,
  ...entifixConstraints,
  ...businessConstraints,
  ...shellConstraints,
  ...hostConstraints,
  { sourceTag: '*', onlyDependOnLibsWithTags: ['*'] },
];

// Spec files may additionally pull in `type:testing` fixtures/doubles from
// anywhere (they are test-only and never shipped), so every allow-list gains
// `type:testing`. Source files stay strict — production code must not import
// a testing lib.
//
// A deny-list constraint (`notDependOnLibsWithTags`, i.e. `host:*`) carries no
// allow-list to widen and passes through unchanged: relaxing it for specs would
// let a Next app reach a database driver through a test file, which is exactly
// the edge it exists to forbid.
const specConstraints = sourceConstraints.map(c =>
  c.sourceTag === '*' || c.onlyDependOnLibsWithTags === undefined
    ? c
    : {
        ...c,
        onlyDependOnLibsWithTags: [
          ...new Set([...c.onlyDependOnLibsWithTags, 'type:testing']),
        ],
      },
);

const allowEslintConfig = ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'];

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/test-output',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: allowEslintConfig,
          depConstraints: sourceConstraints,
        },
      ],
    },
  },
  {
    // `@r10c/entifix-ts-testing-unit` is deliberately non-buildable: it is
    // test-only, never published, and resolves straight to source. Specs are not
    // part of any build output, so the buildable-lib rule does not apply to them
    // — it stays fully enforced for source files. Specs may also import
    // `type:testing` libs (see specConstraints).
    files: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: false,
          allow: allowEslintConfig,
          depConstraints: specConstraints,
        },
      ],
    },
  },
  {
    settings: {
      react: { version: '19.0.0' },
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },
  /**
   * i18n is mandatory, and this is what makes it so rather than a convention:
   * a user-facing string written straight into JSX fails the build.
   *
   * Scoped to everything that renders for a person — the apps, the Next shells,
   * the agnostic controls, and the domain organisms.
   *
   * `ignoreProps` stays **true**. Turning it off was the original intent, to
   * catch untranslated `aria-label`s, but the rule cannot tell copy from a
   * machine value: it flags `field="id"`, `value=""` and `type="date"` just as
   * loudly as `aria-label="Theme"`, and the allowlist needed to quiet those
   * would swallow the real findings. Attribute copy is covered instead by
   * review and by the locale-switch e2e, which renders each app in `en` and so
   * surfaces anything still hardcoded.
   *
   * `allowedStrings` holds glyphs and separators that carry no language.
   * Anything with a letter in it belongs in a catalog.
   */
  {
    // Deliberately basePath-agnostic: Nx runs `eslint` from each project's own
    // directory, so a workspace-rooted glob like `apps/*/src/**` matches
    // nothing and the rule silently never fires. Every `.tsx` under a `src/` is
    // exactly the set that renders for a person.
    files: ['**/src/**/*.tsx'],
    // Declared right here rather than leaned on from a project's own config:
    // ESLint resolves a rule's plugin within the same config object, so without
    // this the rule hard-errors in every project that has no React config of
    // its own (`entifix-ts-testing-unit` was the one that caught it).
    plugins: { react },
    ignores: [
      '**/*.spec.tsx',
      '**/*.test.tsx',
      '**/*.stories.tsx',
      // Design-system playgrounds: the English *is* the specimen. Translating
      // "HeadingOne" or "Body text with inline strong emphasis" would destroy
      // what the page exists to show. Named by their own path — a bare
      // `src/app/page.tsx` matched whichever app happened to keep its copy
      // there, and quietly un-gated marketplace-app's home page until it moved
      // under `[locale]/`.
      '**/design-system/**/*.tsx',
      // Nx generator stubs, kept only so the package has an entry point.
      '**/lib/hello-server.tsx',
      '**/lib/shells-next-*.tsx',
      '**/lib/shells-next-common.tsx',
    ],
    rules: {
      'react/jsx-no-literals': [
        'error',
        {
          noStrings: true,
          ignoreProps: true,
          allowedStrings: [
            // Glyphs and separators. None of these carry language, and every
            // one of them has an accessible name beside it that does.
            '—',
            '·',
            '/',
            '+',
            '#',
            ':',
            ',',
            '(',
            ')',
            '×',
            '✕',
            '↑',
            '↓',
            '☰',
            '⧉',
            '▾',
            '◍',
            '▦',
            '◈',
            '⊞',
            '◕',
            '◉',
          ],
        },
      ],
    },
  },

  /**
   * Catalog ownership. The rule itself carries the reasoning and does its own
   * `apps/` scoping — see tools/eslint-rules/no-foreign-app-namespace.mjs.
   */
  {
    files: ['**/src/**/*.ts', '**/src/**/*.tsx'],
    ignores: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.stories.tsx'],
    plugins: { r10c: r10cPlugin },
    rules: { 'r10c/no-foreign-app-namespace': 'error' },
  },
];
