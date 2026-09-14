/**
 * The tier register: what entifix ships, and what each package is allowed to
 * drag in with it.
 *
 * Declared here rather than derived from the tree, for the reason
 * `tools/slices` declares its stores: a scan can only tell you what the code
 * currently does, and the point of a register is to say what it is *allowed*
 * to do. `tiers.spec.ts` checks the two against each other in both directions.
 *
 * See [ADR 0059](../../../docs/adr/0059-entifix-leaves-the-repo.md).
 */

export const TIERS = {
  0: 'standalone',
  1: 'entity',
  2: 'adapters',
  3: 'ui',
  4: 'app framework',
  5: 'testing',
} as const;

export type Tier = keyof typeof TIERS;

export interface PackageDeclaration {
  /** The manifest `name`. */
  readonly name: string;
  /** Repo-relative directory holding its `package.json`. */
  readonly dir: string;
  readonly tier: Tier;
}

/**
 * Everything entifix publishes. A package under `packages/entifix/` that is
 * missing here fails the build, and so does an entry pointing at a directory
 * that does not exist — the register is not allowed to drift in either
 * direction.
 *
 * ⚠️ `business-ts-authz` still carries its old *name* — every name changes at
 * once, later, so the rename is one reviewable commit. Its grant table has
 * already left for `@r10c/business-ts-authz-grants`, and what remains is the
 * vocabulary and the two policy ports.
 */
export const PACKAGES: readonly PackageDeclaration[] = [
  // T0 — standalone. Nothing below them; each is usable on its own.
  { name: '@r10c/entifix-style', dir: 'packages/entifix/style', tier: 0 },
  {
    name: '@r10c/entifix-ts-tooling',
    dir: 'packages/entifix/ts/tooling',
    tier: 0,
  },

  // T1 — the entity system and the contracts a use case is written against.
  { name: '@r10c/entifix-ts-core', dir: 'packages/entifix/ts/core', tier: 1 },
  {
    name: '@r10c/entifix-ts-business',
    dir: 'packages/entifix/ts/business',
    tier: 1,
  },

  // T2 — adapters. One per external system, so an adopter sees what they
  // installed: `mongodb` and `amqplib` are different answers to "what did this
  // pull in", which is why these are packages rather than subpaths.
  {
    name: '@r10c/entifix-ts-mongo-client',
    dir: 'packages/entifix/ts/mongo-client',
    tier: 2,
  },
  {
    name: '@r10c/entifix-ts-sql-client',
    dir: 'packages/entifix/ts/sql-client',
    tier: 2,
  },
  {
    name: '@r10c/entifix-ts-redis-client',
    dir: 'packages/entifix/ts/redis-client',
    tier: 2,
  },
  {
    name: '@r10c/entifix-ts-amqp-client',
    dir: 'packages/entifix/ts/amqp-client',
    tier: 2,
  },
  {
    name: '@r10c/entifix-ts-rest-client',
    dir: 'packages/entifix/ts/rest-client',
    tier: 2,
  },
  {
    name: '@r10c/entifix-transactions',
    dir: 'packages/entifix/ts/transactions',
    tier: 2,
  },
  {
    name: '@r10c/entifix-ts-jwt-client',
    dir: 'packages/entifix/ts/jwt-client',
    tier: 2,
  },
  {
    name: '@r10c/entifix-ts-zitadel-client',
    dir: 'packages/entifix/ts/zitadel-client',
    tier: 2,
  },
  {
    name: '@r10c/entifix-ts-posthog-client',
    dir: 'packages/entifix/ts/posthog-client',
    tier: 2,
  },
  // The i18next binding of the translator seam — an adapter to an external
  // library exactly as the datastore clients are, which is why it is not T0.
  { name: '@r10c/entifix-ts-i18n', dir: 'packages/entifix/ts/i18n', tier: 2 },

  // T3 — the agnostic UI. Adoptable without T0: a table must not arrive with
  // i18next and a Spanish catalog attached.
  {
    name: '@r10c/entifix-react-controls',
    dir: 'packages/entifix/react/controls',
    tier: 3,
  },
  {
    name: '@r10c/entifix-react-integration',
    dir: 'packages/entifix/react/integration',
    tier: 3,
  },

  // T4 — the application framework: the authorization vocabulary and the two
  // shells that serve and render an entity.
  {
    name: '@r10c/business-ts-authz',
    dir: 'packages/entifix/ts/authz',
    tier: 4,
  },
  {
    name: '@r10c/shells-effect-service',
    dir: 'packages/entifix/effect/service-shell',
    tier: 4,
  },
  {
    name: '@r10c/shells-next-common',
    dir: 'packages/entifix/next/shell',
    tier: 4,
  },
  {
    name: '@r10c/shells-next-i18n',
    dir: 'packages/entifix/next/i18n',
    tier: 4,
  },

  // T5 — testing. Above everything because a double may impersonate anything.
  {
    name: '@r10c/entifix-ts-testing-unit',
    dir: 'packages/entifix/ts/testing-unit',
    tier: 5,
  },
  {
    name: '@r10c/entifix-ts-testing-e2e',
    dir: 'packages/entifix/ts/testing-e2e',
    tier: 5,
  },
  // A stub principal, so an example can serve `$metadata` without an identity
  // provider — by replacing the token and policy ports, never by opening the
  // route. `type:testing`, because its token service trusts every token.
  {
    name: '@r10c/entifix-ts-testing-auth',
    dir: 'packages/entifix/ts/testing-auth',
    tier: 5,
  },
];

export interface CapabilityException {
  readonly name: string;
  readonly because: string;
}

export interface OptionalCapability {
  readonly name: string;
  /** Tiers for which this must be an optional peer rather than a dependency. */
  readonly optionalFor: readonly Tier[];
  /** What an adopter would otherwise install without asking for it. */
  readonly otherwiseInstalls: string;
  /**
   * Packages in those tiers that may hard-depend on it anyway.
   *
   * Named one at a time, with the reason on the line, so an exemption is a
   * thing somebody decided rather than a hole in the rule. A new package in the
   * tier still fails by default.
   */
  readonly except?: readonly CapabilityException[];
}

/**
 * The invariant that actually makes entifix composable, and it is **not about
 * direction** — every edge below points downward, which is legal.
 *
 * What is not legal is a *hard* dependency on a capability the tier is supposed
 * to be adoptable without. Such an edge must be a `peerDependencies` entry
 * carrying `peerDependenciesMeta.optional`, reached through a subpath export:
 * package-level dependencies are not per-subpath, so the optional peer is the
 * part that does the work.
 */
export const OPTIONAL_CAPABILITIES: readonly OptionalCapability[] = [
  {
    name: '@r10c/entifix-ts-i18n',
    optionalFor: [1, 2, 3],
    otherwiseInstalls: 'i18next, react-i18next and a Spanish catalog',
  },
  {
    name: '@r10c/entifix-transactions',
    optionalFor: [2],
    otherwiseInstalls: 'the transactional outbox and the saga engine',
    except: [
      {
        name: '@r10c/entifix-ts-rest-client',
        because:
          'the REST save adapter writes `makeCommandEnvelope` onto the wire ' +
          'and reads `readTransactionAcceptedEnvelope` back, which is the ' +
          'shape of a save in this framework rather than an optional extra. ' +
          'The sink itself is already optional at runtime — the adapter asks ' +
          'for it with `Effect.serviceOption` — but the envelope is not, so a ' +
          'subpath here would hold the whole of entity CRUD over REST.',
      },
    ],
  },
  {
    name: '@r10c/entifix-ts-mongo-client',
    optionalFor: [5],
    otherwiseInstalls: 'the `mongodb` driver',
  },
  {
    name: '@r10c/entifix-ts-redis-client',
    optionalFor: [5],
    otherwiseInstalls: 'the `ioredis` driver',
  },
  {
    name: '@r10c/entifix-ts-amqp-client',
    optionalFor: [5],
    otherwiseInstalls: 'the `amqplib` driver',
  },
];

/**
 * Directories scanned for packages that ought to be registered above. Every
 * `package.json` found under one of these must appear in {@link PACKAGES}.
 *
 * `packages/business/ts` is deliberately **not** here: it holds r10c's domains,
 * and only `authz` crosses over. It is registered by name instead.
 */
export const SCANNED_ROOTS = ['packages/entifix'] as const;
