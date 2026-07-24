import nx from '@nx/eslint-plugin';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

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
//   type:*     testing/e2e helpers (relaxed — see specConstraints).
//
// The rule ANDs every constraint whose `sourceTag` a project carries, so the
// three dimensions compose. See docs/DEVELOPING.md → "Module boundaries".
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
    onlyDependOnLibsWithTags: ['layer:entifix', 'layer:utils'],
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

// Strict constraints for source files. The trailing `*` catch-all lets any
// untagged project (e.g. testing/e2e) and external deps still resolve.
const sourceConstraints = [
  ...layerConstraints,
  ...scopeConstraints,
  ...entifixConstraints,
  { sourceTag: '*', onlyDependOnLibsWithTags: ['*'] },
];

// Spec files may additionally pull in `type:testing` fixtures/doubles from
// anywhere (they are test-only and never shipped), so every allow-list gains
// `type:testing`. Source files stay strict — production code must not import
// a testing lib.
const specConstraints = sourceConstraints.map(c =>
  c.sourceTag === '*'
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
];
