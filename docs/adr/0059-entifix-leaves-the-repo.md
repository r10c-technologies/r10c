# 59. entifix leaves the repo, and r10c becomes one of its consumers

- Status: Accepted
- Date: 2026-09-14
- Area: platform
- Read when: looking for the framework's source, changing entifix while r10c runs, or wondering why a framework file imports a cookie name from core instead of declaring its own — the boundary is wide but composable, and every r10c-specific value crosses a seam rather than being imported
- Revised: 2026-09-16 — built on r10c's side (#273, #278). `packages/entifix`
  and `tools/tiers` are deleted; the 23 packages install from the registry at one
  version, written once in the `pnpm-workspace.yaml` catalog. The local loop the
  last section leaves to entifix now has a consumer half: each checkout keeps its
  own gitignored entifix clone at `.entifix/`, and `tools/entifix` syncs it over
  the release and puts the release back (DEVELOPING.md → "Working on entifix
  from r10c").

## Context

`packages/entifix/` is a general entity framework that has only ever had one
consumer. It is 24 packages and roughly 74k lines, with 187 spec files and **zero
e2e of its own** — everything it does is proven by driving r10c. A second
application arrives in the next days, and it will not live in this repository.
At that point "does entifix still work" stops being answerable by
`nx run-many -t test` here.

Two facts make the timing forced rather than chosen. This repository is public
now and **private in a couple of months**, so a framework that stays inside it
becomes unreadable to its own second consumer. And exposure is decided per commit
and permanently ([ADR 0025](0025-where-planning-and-business-knowledge-live.md)),
so the decision cannot be deferred and then reversed.

The framework is already close to separable. Its dependency graph is a clean DAG
with four zero-dependency roots — `core`→`effect`, `tooling`→`@opentelemetry/api`,
`i18n`→`i18next`, `style`→nothing — and exactly **one** import crosses out of it:
`isEmpty` from `@r10c/utils-ts-object`, in
`react/integration/src/context/adapters-context/adapters-context.tsx`.

What is not separable is the product data threaded through it. The i18n package
ships `'r10c Admin'` and `'Back-office del marketplace r10c'`. The authorization
package ships `ROLE_PERMISSIONS`, which says a `user` may ring up a counter sale.
`require-principal.ts` reads a cookie named `r10c_at`. None of that is framework.

## Decision

**entifix is extracted into `r10c-technologies/entifix` and published as
`@entifix/*`, with r10c as one of two external consumers.** Fixed versioning
across all packages, first release `0.1.0`, an Nx monorepo like this one.

### The boundary is wide, and composable

entifix ships the entity system **and** the shells that serve and render it — the
Effect service base and the Next shell, not just the metadata layer. A framework
that describes entities but leaves you to write the route that serves them has
handed over the smaller half.

Composability is what keeps that honest. Six tiers, and a package may hard-depend
only on its own tier or below:

```
T0  standalone     style · tooling
T1  entity         core · business
T2  adapters       mongo · sql · redis · amqp · rest · transactions
                   jwt · zitadel · posthog · i18n
T3  ui             react-controls · react-integration
T4  app framework  authz · service-shell · next-shell · next-i18n
T5  testing        testing-unit · testing-e2e · testing-auth
```

Someone who wants only entity metadata takes T1. Someone who wants a table takes
T3 and must not thereby install i18next, a Spanish catalog, a Mongo driver and a
saga engine.

`i18n` is an adapter rather than standalone: it is the i18next binding of the
translator port `react-controls` declares, exactly as `mongo` is the driver binding
of a repository. `authn` does not ship at all — it holds entity classes, use cases
and repositories r10c's `auth` slice owns, and the only thing the Next shell took
from it was four session-timing constants, which became hook options.

⚠️ **The invariant that enforces this is not about direction.** Three of the four
composition defects found when the tiers were drawn point _downward_ —
`react-controls`→`i18n`, the datastore adapters→`transactions`, and
`testing-e2e`→three database drivers. The fourth, `next-shell`→`authn`, left the
framework entirely. A downward edge is legal; what is not is a
**hard** dependency on an optional capability. Such an edge must be a
`peerDependencies` entry with `peerDependenciesMeta.optional` behind a subpath
export. `@entifix/tiers`, in the entifix repository, fails the build on both rules, and on a package carrying no
`tier:` tag.

### The seam takes values, never file paths

Four places had r10c baked into framework code, and all four resolve the same
way: the framework declares a port, the host supplies a value at composition.

| what                     | framework declares                                                                                             | r10c supplies                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| catalogs                 | a namespace per package for the copy it renders (`controls`, `shell`), and a registry to install catalogs into | `entity`, `errors` and `app` — the copy that names its own entities, codes and back office — and the single `declare module 'i18next'` |
| grants                   | `PolicyDecision`, `can(grants, …)`                                                                             | `ROLE_PERMISSIONS`, `SERVICE_CROSSING_PERMISSIONS`                                                                                     |
| cookie and storage names | neutral names, fixed, declared once in core; storage keys that were already parameters keep a neutral default  | nothing — r10c adopts `entifix_at`, `entifix_sid`, `entifix_locale`, and stops re-declaring them                                       |
| the principal            | `TokenServiceTag`, `PolicyDecisionTag`                                                                         | the Zitadel-backed Layers                                                                                                              |

**A value, not a path.** A framework that takes `./config/roles.json` has to
resolve, read and parse it, which means it now owns a filesystem contract and a
failure mode per host. TypeScript is the default supply because `Permission` is a
template-literal type and `Record<Role, readonly Permission[]>` makes a typo a
compile error; JSON is accepted, validated through Standard Schema, for a host
that must configure at runtime.

⚠️ **The typed-key gate is the one seam that cannot be split.** TypeScript permits
exactly one `declare module 'i18next' { interface CustomTypeOptions }` per
compilation — a second is `TS2717: subsequent property declarations must have the
same type`. So catalogs are owned per package but the _type_ gate is composed by
the host, in about ten lines. Every `useT` call site reads exactly as before;
what an adopter gains is a file they must write, and it belongs in the README.

### History starts fresh

No `git filter-repo` transplant. Of the 123 commits touching this tree,
**100 touch `packages/entifix` and exactly 1 touches it alone** — so a filtered
history would be 99 commits whose messages describe marketplace work that no
longer exists in the repository they land in. The history stays here, where it is
true, and entifix starts at its first commit.

### Records stay here; entifix starts its own collection

All 58 existing records stay in this repository. Two collections each numbering
from a shared origin would collide on the next decision either side takes, and
these records are about the marketplace — the reasoning behind
`@entifix/next-shell` is inseparable from the back office it was drawn for.
entifix begins its own collection at 0001.

⚠️ **The rename rewrites identifiers in 29 existing records and revises none of
them.** `@r10c/entifix-ts-core` is written `@entifix/core` throughout, because a
reader greps the current name and a record naming a package that no longer exists
is a dead end. No record gains a `- Revised:` line for it: nothing any of them
_asserts_ has changed, only the spelling of a name, and 29 Revised lines pointing
at one mechanical pass would bury the four real in-place corrections this
collection has made. The mapping is here, once:

```
@r10c/entifix-ts-core            → @entifix/core
@r10c/entifix-ts-business        → @entifix/business
@r10c/entifix-transactions       → @entifix/transactions
@r10c/entifix-ts-<engine>-client → @entifix/<engine>
@r10c/entifix-react-controls     → @entifix/react-controls
@r10c/entifix-react-integration  → @entifix/react-integration
@r10c/entifix-style              → @entifix/style
@r10c/entifix-ts-tooling         → @entifix/tooling
@r10c/entifix-ts-i18n            → @entifix/i18n
@r10c/entifix-ts-testing-*       → @entifix/testing-*
@r10c/shells-effect-service      → @entifix/service-shell
@r10c/shells-next-common         → @entifix/next-shell
@r10c/shells-next-i18n           → @entifix/next-i18n
@r10c/business-ts-authz          → @entifix/authz   (the vocabulary half;
                                   the grants stay as @r10c/business-ts-authz-grants)
```

### Big bang, because there is nothing to stage against

Nothing runs in production, so there is no compatibility window, no dual-name
period and no deprecation pass. The r10c-side work lands on one branch while a
single `nx run-many -t typecheck,build,lint,test` can still prove both halves,
and the copy into the new repository follows it.

## Consequences

- **One command stops proving the whole thing.** Today a change to `core` is
  checked against 24 packages, 10 services and 2 Next apps. After the split it is
  checked against entifix's own examples, and r10c finds out on upgrade. Three
  example apps in the entifix repository exist to narrow that gap; they are not
  the marketplace and will not close it.
- **Two-repo changes get slower on purpose.** A framework change r10c needs is a
  release there and a bump here, or a local link. That friction is the thing
  being bought: it is what stops a marketplace requirement being answered by
  editing the framework.
- **Every adopter writes the i18n augmentation.** Ten lines, and a wrong one is a
  compile error rather than a runtime surprise — but it is the first thing an
  adopter meets.
- **Three packages ship unexercised.** `@entifix/zitadel`, `@entifix/jwt` and
  `@entifix/posthog` have no example. The README says so rather than letting an
  adopter infer coverage from their presence.
- ⚠️ **The catalog registry has to be installed once per bundle.** `getServerT`
  is called inside server components with no composition root to thread a value
  through, so catalogs are installed into a registry — and a Next application's
  server and client are separate bundles with separate module state. r10c first
  installed only from its `'use client'` provider, and every server render threw
  `No i18n catalogs are installed`; no unit spec could see it, because specs
  install catalogs themselves. A host installs from its root layout for the
  server graph and from its provider for the client.
- ⚠️ **`@r10c/source` is joined, not renamed.** The custom export condition is a
  workspace-wide convention used by **73** projects here, most of which are not
  entifix. entifix packages key their `exports` on `@entifix/source`; this
  repository lists both conditions in all six places it appears —
  `tsconfig.base.json`, `nx.json`'s e2e `NODE_OPTIONS`, `vitest.shared.mts`, the
  Storybook config, every service's `webpack.config.js`, and the marketplace e2e
  mock server that must run with it **off**. Miss one and resolution falls back
  to `dist`, which mostly works, which is why it would go unnoticed. **Since
  #273 the `@entifix/source` condition is gone from all six**: the installed
  packages ship `dist` only, and their manifests still map that condition to a
  `./src/index.ts` the tarball does not contain.

## What this record does not decide

The publishing mechanism (npm provenance, the release workflow), the local
development loop between the two repositories, and the three example
applications. Each is its own decision, taken in the entifix repository's own
collection.
