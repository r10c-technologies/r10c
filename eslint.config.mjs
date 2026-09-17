import nx from '@nx/eslint-plugin';
import react from 'eslint-plugin-react';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

import { r10cPlugin } from './tools/eslint/no-foreign-app-namespace.mjs';

// ---------------------------------------------------------------------------
// Module-boundary hierarchy (enforced by @nx/enforce-module-boundaries).
//
// Every project is tagged in its package.json `nx.tags` across these dimensions:
//   layer:*    app › shell › implementation › business › utils
//              (a project may only depend DOWNWARD). The framework is not a
//              layer here: `@entifix/*` is installed from the registry, and an
//              external package carries no tags — any layer may import it.
//   scope:*    a domain scope (marketplace / marketplace-admin / auth /
//              transaction / config) may only depend on itself or `scope:shared`;
//              `scope:shared` is the reusable core and is dependable by anyone.
//   business:* internal ordering INSIDE the business layer: policy ‹ domain
//              (a domain may use the shared authorization vocabulary; it may
//              never import another domain)
//   shell:*    a domain shell mounts one domain onto the framework's base
//              shells (installed); it never imports another domain shell
//   host:*     what kind of runtime host an app is — `next` or `effect`. A Next
//              app may not import entifix's datastore clients at all.
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
      'layer:utils',
    ],
  },
  {
    sourceTag: 'layer:implementation',
    onlyDependOnLibsWithTags: ['layer:business', 'layer:utils'],
  },
  {
    sourceTag: 'layer:business',
    onlyDependOnLibsWithTags: [
      // Same-layer edges are allowed but ORDERED by `business:*` below. Without
      // that second dimension this line would let any domain import any other.
      'layer:business',
      'layer:utils',
    ],
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
  // A **host** scope, not a domain one. `back-office-app` composes two domain
  // shells into one origin, which is the tag-level form of ADR 0008's
  // "page-level aggregation across domains belongs in the RSC". The rule is not
  // weakened by this: `scope:auth` and `scope:marketplace-admin` still cannot
  // reach each other, because neither of them carries this tag — only the host
  // that mounts both does.
  {
    sourceTag: 'scope:back-office',
    onlyDependOnLibsWithTags: [
      'scope:back-office',
      'scope:marketplace-admin',
      'scope:auth',
      // The stock shell, mounted for the same reason the two above are: this
      // host composes several domains into one origin. Widening the **host**
      // scope is how a domain reaches the back office; `scope:stock` gains
      // nothing by it, and still cannot reach `scope:auth` or
      // `scope:marketplace-admin` — only the host that mounts all of them can.
      'scope:stock',
      // The order shell, for the same reason. Widening the **host** scope is how
      // a domain reaches the back office; `scope:order` gains nothing by it, and
      // still cannot reach `scope:auth`, `scope:stock` or
      // `scope:marketplace-admin` — only the host that mounts all of them can.
      'scope:order',
      // The sales shell — the channel screens and the till. Same rule: widening
      // the **host** scope is how a domain reaches the back office, and
      // `scope:sales` gains nothing by it.
      'scope:sales',
      // The settlement shell — a vendor's commercial terms and what they are
      // owed. Same rule: widening the **host** scope is how a domain reaches the
      // back office, and `scope:settlement` gains nothing by it.
      'scope:settlement',
      'scope:shared',
    ],
  },
  // The coordinator's own app, registered when the slice was split out to
  // `:3103` (#229). It hosts **no domain**, so it reaches nothing but the
  // shared core — a saga definition is data, and the whole reason it is data is
  // that an orchestrator may not import the domains it coordinates.
  {
    sourceTag: 'scope:transaction',
    onlyDependOnLibsWithTags: ['scope:transaction', 'scope:shared'],
  },
  {
    sourceTag: 'scope:config',
    onlyDependOnLibsWithTags: ['scope:config', 'scope:shared'],
  },
  // The `stock` slice's own app. Registered here the moment the scope exists:
  // a tag with no entry in this list is *unconstrained* rather than isolated,
  // so omitting it would silently switch the boundary rule off for the new
  // service instead of failing a build.
  {
    sourceTag: 'scope:stock',
    onlyDependOnLibsWithTags: ['scope:stock', 'scope:shared'],
  },
  // The `order` slice's own app, for the same reason as the two above.
  {
    sourceTag: 'scope:order',
    onlyDependOnLibsWithTags: ['scope:order', 'scope:shared'],
  },
  // The `payment` slice's own app, for the same reason as the three above. It
  // has no shell and no back-office surface yet, so the host scope is
  // deliberately *not* widened to reach it — a payment is read through the order
  // it belongs to until something needs otherwise.
  {
    sourceTag: 'scope:payment',
    onlyDependOnLibsWithTags: ['scope:payment', 'scope:shared'],
  },
  // The `settlement` slice's own app. It reaches nothing but the shared core:
  // both of its inputs arrive on the bus, so it imports no other domain's
  // package and dials no other slice's service.
  {
    sourceTag: 'scope:settlement',
    onlyDependOnLibsWithTags: ['scope:settlement', 'scope:shared'],
  },
  // The `sales` slice's own app and its back-office shell, for the same reason
  // as the four above.
  {
    sourceTag: 'scope:sales',
    onlyDependOnLibsWithTags: ['scope:sales', 'scope:shared'],
  },
];

// Internal ordering INSIDE the business layer.
// `policy` is the authorization vocabulary every domain may express itself in;
// a `domain` may reach down to it but never sideways to another domain.
const businessConstraints = [
  {
    sourceTag: 'business:policy',
    onlyDependOnLibsWithTags: ['layer:utils'],
  },
  {
    sourceTag: 'business:domain',
    onlyDependOnLibsWithTags: ['business:policy', 'layer:utils'],
  },
];

// Internal ordering INSIDE the shell layer. The base shells a domain shell
// mounts onto (`@entifix/service-shell`, `@entifix/next-shell`,
// `@entifix/next-i18n`) are installed packages, so what is left to order is that
// a domain shell never reaches sideways into another one.
const shellConstraints = [
  {
    sourceTag: 'shell:domain',
    onlyDependOnLibsWithTags: [
      'layer:implementation',
      'layer:business',
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
//
// ⚠️ A ban on external imports, not a tag. The datastore clients used to carry
// `runtime:datastore` as in-tree projects; installed from the registry they
// carry no tags, so a `notDependOnLibsWithTags` rule would still pass while
// matching nothing. Each client is named twice because a subpath import
// (`@entifix/mongo/transactions`) does not match the bare package name.
const hostConstraints = [
  {
    sourceTag: 'host:next',
    bannedExternalImports: [
      '@entifix/mongo',
      '@entifix/mongo/*',
      '@entifix/sql',
      '@entifix/sql/*',
      '@entifix/redis',
      '@entifix/redis/*',
      '@entifix/amqp',
      '@entifix/amqp/*',
    ],
  },
];

// Strict constraints for source files. The trailing `*` catch-all lets any
// untagged project (e.g. testing/e2e) and external deps still resolve.
const sourceConstraints = [
  ...layerConstraints,
  ...scopeConstraints,
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
// A deny-list constraint (`bannedExternalImports`, i.e. `host:*`) carries no
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
      // `tsc --build` output. Not ignored here, a `typecheck` run leaves
      // generated `.d.ts` behind that the next `lint` reports errors in — so
      // whether lint passes depends on which targets ran before it. Several
      // projects carried their own copy of this line; the ones that did not
      // were simply the ones nobody had typechecked yet.
      '**/out-tsc',
      '**/test-output',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
      // A consumer's own entifix clone (tools/entifix). It is gitignored, but
      // flat config does not read `.gitignore`, and entifix lints itself.
      '.entifix/**',
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
    // Specs are not part of any build output, so the buildable-lib rule does not apply to them
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
    // its own (`@entifix/testing-unit` was the one that caught it).
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
            '↗',
            '▸',
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
   * `apps/` scoping — see tools/eslint/no-foreign-app-namespace.mjs.
   */
  {
    files: ['**/src/**/*.ts', '**/src/**/*.tsx'],
    ignores: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.stories.tsx'],
    plugins: { r10c: r10cPlugin },
    rules: { 'r10c/no-foreign-app-namespace': 'error' },
  },
];
