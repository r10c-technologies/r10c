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
//   tech:*     what an implementation cell is written in — react / next / http
//              / mongo / redis / sql — and so which mechanisms it may not talk
//              through (docs/adr/0060).
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

// Internal ordering INSIDE the shell layer (ADR 0064). Three kinds:
//
// - `shell:base` — r10c's fleet composition every Effect service shares
//   (`@r10c/shells-effect-service`), beside the installed base shells
//   (`@entifix/service-shell`, `@entifix/next-shell`, `@entifix/next-i18n`).
// - `shell:domain` — one slice that owns a domain, mounted onto the base.
// - `shell:platform` — one slice that declares no domain (`transaction`).
//
// A domain or platform shell may reach down to the base and never sideways
// into another shell, of either kind; the base reaches neither, so it can
// never come to depend on the slices composed onto it.
const SLICE_SHELL_MAY_IMPORT = [
  'shell:base',
  'layer:implementation',
  'layer:business',
  'layer:utils',
];
const shellConstraints = [
  {
    sourceTag: 'shell:base',
    onlyDependOnLibsWithTags: [
      'layer:implementation',
      'layer:business',
      'layer:utils',
    ],
  },
  {
    sourceTag: 'shell:domain',
    onlyDependOnLibsWithTags: SLICE_SHELL_MAY_IMPORT,
  },
  {
    sourceTag: 'shell:platform',
    onlyDependOnLibsWithTags: SLICE_SHELL_MAY_IMPORT,
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

// What an implementation cell is written in, and therefore what it may not talk
// through (docs/adr/0060). A cell depends on entities, use cases and ports; the
// mechanism behind a port is chosen at composition — a shell or an app — and
// never imported by the cell. Cell→cell needs no rule here: `layer:implementation`
// allows no same-layer edge.
//
// Bans on external imports, for the same reason as `host:*` above: entifix is
// installed and carries no tags. Each package is named twice because a subpath
// does not match the bare name.
const both = names => names.flatMap(name => [name, `${name}/*`]);

/** The adapters behind entifix's ports, plus the drivers they wrap. */
const ADAPTERS = both([
  '@entifix/rest',
  '@entifix/static',
  '@entifix/mongo',
  '@entifix/sql',
  '@entifix/redis',
  '@entifix/amqp',
  '@entifix/jwt',
  '@entifix/zitadel',
  '@entifix/posthog',
]);
const DRIVERS = both(['mongodb', 'ioredis', 'amqplib', 'pg', '@effect/sql-pg']);

/**
 * Only a shell composes a flow or builds a verified context (ADR 0065): a cell
 * or a business package that imported these could build a slip the engine
 * would run, or forge the context a resolver trusts.
 */
const SHELL_ONLY = ['@entifix/business/compose', '@entifix/business/verified'];

/**
 * Banned in every cell that is not persistence. `next-shell/server` holds the
 * config-service protocol and the service token; `react-controls/i18next` binds
 * a translator a cell only needs the port of; TanStack and redux are state
 * mechanisms the framework's hooks already sit in front of.
 */
const COMPOSITION_ONLY = [
  ...SHELL_ONLY,
  ...ADAPTERS,
  ...DRIVERS,
  '@entifix/react-controls/i18next',
  '@entifix/next-shell/server',
  // The mechanism halves entifix 0.5.0 split out of its contract entries: the
  // saga engine, the service runtime and its telemetry and test server, and
  // the browser's EventSource transport.
  '@entifix/transactions/engine',
  '@entifix/service-shell/runtime',
  '@entifix/service-shell/observability',
  '@entifix/service-shell/testing',
  '@entifix/react-integration/event-source',
  '@tanstack/*',
  ...both(['redux', 'react-redux', '@reduxjs/toolkit']),
];

/** What a persistence cell is never written in. */
const UI_AND_HTTP = both([
  'react',
  'react-dom',
  'next',
  '@entifix/react-controls',
  '@entifix/react-integration',
  '@entifix/next-shell',
  '@entifix/next-i18n',
  '@entifix/service-shell',
  '@entifix/rest',
  '@entifix/static',
  '@entifix/jwt',
  '@entifix/zitadel',
  '@entifix/posthog',
  '@tanstack/react-query',
  '@tanstack/react-form',
]);

/** A persistence cell is its own engine's adapter, and no other engine's. */
const ENGINES = {
  mongo: both(['@entifix/mongo', 'mongodb']),
  redis: both(['@entifix/redis', 'ioredis']),
  sql: both(['@entifix/sql', 'pg', '@effect/sql-pg']),
};
const otherEngines = own => [
  ...Object.entries(ENGINES)
    .filter(([engine]) => engine !== own)
    .flatMap(([, names]) => names),
  ...both(['@entifix/amqp', 'amqplib']),
];

const techConstraints = [
  // Plain React: no Next, so the same cell mounts in any React host.
  {
    sourceTag: 'tech:react',
    bannedExternalImports: [...COMPOSITION_ONLY, ...both(['next'])],
  },
  { sourceTag: 'tech:next', bannedExternalImports: COMPOSITION_ONLY },
  {
    sourceTag: 'tech:http',
    bannedExternalImports: [
      ...COMPOSITION_ONLY,
      ...both(['react', 'react-dom', 'next']),
      ...both([
        '@entifix/react-controls',
        '@entifix/react-integration',
        '@entifix/next-shell',
        '@entifix/next-i18n',
      ]),
    ],
  },
  ...Object.keys(ENGINES).map(engine => ({
    sourceTag: `tech:${engine}`,
    bannedExternalImports: [
      ...SHELL_ONLY,
      ...UI_AND_HTTP,
      ...otherEngines(engine),
    ],
  })),
  // A business package declares fragments with `/flow` and never composes.
  { sourceTag: 'layer:business', bannedExternalImports: SHELL_ONLY },
];

// Strict constraints for source files. The trailing `*` catch-all lets any
// untagged project (e.g. testing/e2e) and external deps still resolve.
const sourceConstraints = [
  ...layerConstraints,
  ...scopeConstraints,
  ...businessConstraints,
  ...shellConstraints,
  ...hostConstraints,
  ...techConstraints,
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

/**
 * What an Effect service's `src/` may not import (ADR 0064): apps only mount.
 * Routes, an HTTP API and the saga engine are composition, and composition is
 * the slice's shell's — a route or an engine wired in an app is a second place
 * a reader has to look for what a failure means.
 *
 * Spread by each service's own `eslint.config.mjs`, for the reason
 * `serviceE2eConfig` is: a flat-config glob resolves against the config that
 * declares it. The root list carries the same rule at `apps/*-service/src`, so
 * a lint run from the repository root — and `@r10c/conventions`' planted app
 * file — reads it too.
 */
const SERVICE_APP_RESTRICTIONS = {
  'no-restricted-imports': [
    'error',
    {
      paths: [
        {
          name: 'effect/http',
          importNames: ['HttpRouter'],
          message:
            'Routes are composed by the slice shell; a service only mounts it (ADR 0064).',
        },
        {
          name: 'effect/http-api',
          message:
            'An HTTP API is composed by the slice shell; a service only mounts it (ADR 0064).',
        },
        {
          name: '@r10c/shells-effect-service',
          importNames: ['logSliceOutcome'],
          message:
            'Only the slice shell logs; a service answers an outcome for its shell to log (ADR 0064).',
        },
      ],
      patterns: [
        {
          group: ['@entifix/*/engine'],
          message:
            'The engine is composed by the slice shell; a service only mounts it (ADR 0064).',
        },
      ],
    },
  ],
};

export const serviceAppConfig = {
  files: ['src/**/*.ts'],
  ignores: ['src/**/*.spec.ts'],
  rules: SERVICE_APP_RESTRICTIONS,
};

/**
 * A bus consumer never retries in process: redelivery is its only retry, and
 * its ceiling is the subscription's `maxAttempts`, which the slices register
 * holds to the fleet delivery budget (ADR 0064, entifix ADR 0014). An
 * `Effect.retry` or `On(…).retry` inside a `subscribe(…)` handler would
 * multiply that budget by its own attempts.
 *
 * Matched inside the call that registers the handler, so the rule is about
 * consumers and not about the shell's other retries. Spread by each slice
 * shell's own config and carried at the root too, for the reason
 * `serviceAppConfig` is.
 */
const CONSUMER_RETRY_RESTRICTIONS = {
  'no-restricted-syntax': [
    'error',
    {
      selector:
        "CallExpression[callee.property.name='subscribe'] CallExpression[callee.object.name='Effect'][callee.property.name='retry']",
      message:
        'A consumer handler never retries in process; redelivery is its retry (ADR 0064).',
    },
    {
      selector:
        "CallExpression[callee.property.name='subscribe'] CallExpression[callee.property.name='retry'][callee.object.callee.name='On']",
      message:
        'A consumer handler never retries in process; redelivery is its retry (ADR 0064).',
    },
  ],
};

export const sliceShellConfig = {
  files: ['src/**/*.ts'],
  ignores: ['src/**/*.spec.ts'],
  rules: CONSUMER_RETRY_RESTRICTIONS,
};

/**
 * Nobody below the slice shell logs (ADR 0064). A use case or a cell returns an
 * outcome — a report, a typed failure — and the shell that forks the work
 * logs it with a code, a category and a trace id, never `String(error)`.
 * Logging from below would decide a level and a sink in code that cannot see
 * either, and is how a failure ends up logged twice or with its text.
 *
 * Spread by every business and implementation project's own config, and
 * carried at the root too, for the reason `serviceAppConfig` is.
 */
const NO_LOGGING_BELOW_THE_SHELL = {
  'no-restricted-syntax': [
    'error',
    {
      selector:
        "CallExpression[callee.object.name='Effect'][callee.property.name=/^log/]",
      message:
        'Only the slice shell logs: return an outcome instead (ADR 0064).',
    },
    {
      selector:
        "CallExpression[callee.object.name='Effect'][callee.property.name=/^(annotateLogs|withLogSpan)$/]",
      message:
        'Only the slice shell logs: return an outcome instead (ADR 0064).',
    },
    {
      selector: "CallExpression[callee.object.name='console']",
      message:
        'Only the slice shell logs: return an outcome instead (ADR 0064).',
    },
  ],
};

export const silentLayerConfig = {
  files: ['src/**/*.ts', 'src/**/*.tsx'],
  ignores: ['src/**/*.spec.ts', 'src/**/*.spec.tsx', 'src/**/*.stories.tsx'],
  rules: NO_LOGGING_BELOW_THE_SHELL,
};

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
  {
    files: [
      'packages/business/**/src/**/*.{ts,tsx}',
      'packages/implementation/**/src/**/*.{ts,tsx}',
    ],
    ignores: ['**/*.spec.{ts,tsx}', '**/*.stories.tsx'],
    rules: NO_LOGGING_BELOW_THE_SHELL,
  },
  {
    files: ['packages/shells/effect/*/src/**/*.ts'],
    ignores: ['packages/shells/effect/*/src/**/*.spec.ts'],
    rules: CONSUMER_RETRY_RESTRICTIONS,
  },
  {
    files: ['apps/*-service/src/**/*.ts'],
    ignores: ['apps/*-service/src/**/*.spec.ts'],
    rules: SERVICE_APP_RESTRICTIONS,
  },
];

/**
 * Spread by each service e2e project's own `eslint.config.mjs`, after the base.
 *
 * A service's e2e project boots that service in-process for the `mock` profile
 * (`src/support/mock-service.ts` builds its router and Layers), so it imports
 * the service it tests — the one edge an e2e project exists for, and declared as
 * its `implicitDependencies`. Nx 23.3 infers a service as an application, and
 * the rule forbids importing an application whatever the tags say, so these
 * projects name that one import as allowed. Nothing else is relaxed: the
 * depConstraints are the spec ones, as for any test-only code.
 *
 * Exported rather than declared here with an `apps/*-e2e/**` glob, because a
 * flat-config glob resolves against the config file that declares it, and a
 * project lints itself through its own.
 */
export const serviceE2eConfig = {
  files: ['**/*.ts'],
  rules: {
    '@nx/enforce-module-boundaries': [
      'error',
      {
        enforceBuildableLibDependency: false,
        allow: [...allowEslintConfig, '^@r10c/[a-z-]+-service$'],
        depConstraints: specConstraints,
      },
    ],
  },
};
