# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository. This file is a
**router**: the operational essentials below are `@import`ed from single-source
snippets in `docs/_shared/` (so they can never drift from the docs that also use
them), and everything deep is a link — loaded only when a task needs it.

## Documentation map

| Doc                                                            | When you need it                                                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                   | Layering, the use-case + adapter mechanism, Effect-native backends, auth, transactions, observability, domain structure.                                |
| [docs/BUSINESS-ARCHITECTURE.md](docs/BUSINESS-ARCHITECTURE.md) | The **business** side: capability map, ODA/SID glossary, personas as party roles, data planes, catalog publication, stock rules.                        |
| [docs/ENTIFIX.md](docs/ENTIFIX.md)                             | The entity framework in depth: entities, links, the Effect-agnostic use-case, adapter contract, the RSQL query protocol.                                |
| [docs/FRONTEND.md](docs/FRONTEND.md)                           | The client side: design system (tokens, flex-first layout primitives, Storybook) **and** the workspace tabs + TanStack data layer.                      |
| [docs/I18N.md](docs/I18N.md)                                   | Locales, catalogs, locale routing, entity label keys, error codes, and the three gates that make i18n mandatory.                                        |
| [docs/DEVELOPING.md](docs/DEVELOPING.md)                       | Nx/pnpm workspace, commands, local infra, **module boundaries**, entities, backends, testing (`E2E_PROFILE`), dependency updates, conventions, commits. |
| [docs/adr/](docs/adr/)                                         | Architecture Decision Records (e.g. [0001 observability & tooling](docs/adr/0001-observability-and-tooling.md)).                                        |

`docs/_shared/` holds the small snippets imported below; edit the snippet, not the copies.

## Tooling & commands

@docs/_shared/commands.md

## Layering & module boundaries

@docs/_shared/layering.md

## App & port convention

@docs/_shared/ports.md

## Stores, slices & data planes

@docs/_shared/planes.md

## Rules that override a default

Short list on purpose. Everything here is a rule that contradicts what a
reasonable person would otherwise do, and that lives in no single deep doc —
which is why it is repeated in the one file always loaded. The reasoning behind
each is one link away in the decision index below.

- **Nothing runs in production.** Every environment is a local dev fleet, and
  infrastructure and data are recreated on demand (`pnpm run <app>:dev:reset`).
  So **do not design for backward compatibility** — no dual-read windows, no
  legacy fallbacks, no migration shims, no compatibility flags — unless the user
  explicitly asks for a staged swap. Change the seed, change the shape, and
  reset. A compatibility path written "just in case" is dead code that has to be
  maintained and reasoned about at every later step, and some of them (a verifier
  that branches on a token's `alg`, say) open a security surface a hard cut never
  opens.
- **A working convention is a check, and attribution is the first one.** No
  AI/tool co-author trailer, no session trailer and no "generated with" line —
  on a commit, a pull-request body or a document. Enforced in three places
  against one predicate (`tools/conventions/attribution.mjs`): `commitlint`
  refuses the commit, `@r10c/conventions` refuses the committed file, and a CI
  step refuses the PR body, which is the one surface no git hook can see. It is
  stated **here** rather than only in `DEVELOPING.md` for the reason the record
  is about: a session-start reminder supplies those trailers and claims to
  replace earlier guidance, it fires every session in the most privileged
  position in the context, and against that a rule one hop away lost on **5 of
  the last 40 merged pull requests** and **6 of the last 60 commits** on `main`.
  ⚠️ The canonical casing is git's, not the documentation's: every real violation
  reads lowercase `authored`, so a pattern written from the title-cased form in
  the prose would have caught none of them while looking correct in review.
  [ADR 0046](docs/adr/0046-conventions-are-checked-not-stated.md).
- **Boundaries are enforced; to make an edge legal, retag — never weaken the
  rule.** Imports point downward and stay in-scope, driven by each project's
  `nx.tags`, and `@nx/enforce-module-boundaries` fails the build otherwise. A new
  project needs `layer:`/`scope:` tags (and `entifix:`, `business:`, `shell:` or
  `host:` where they apply). See
  [DEVELOPING.md → Module boundaries](docs/DEVELOPING.md#module-boundaries).
- **Inject with Effect.** Wire dependencies as `Context.Tag` subclasses provided
  via `Layer`, not instances through constructors — a missing dep is a compile
  error.
- **Entities describe themselves.** Private `#field` + `@accessor()` getter/setter
  (a field without a getter is invisible to adapters). Pass `type`/`label` (and
  `sortable`/`filterable`/`hidden` where they differ from defaults). A member's
  `filterable`/`sortable` metadata is also the **server-side allowlist** — a query
  naming a member that lacks it is rejected `400`, so making a member queryable is
  a one-line change on the entity and nowhere else.
  See [docs/ENTIFIX.md](docs/ENTIFIX.md).
- **A server-owned but client-visible member must not be `@accessor({ readonly })`.**
  That flag drops the member from serialization **and** deserialization, so a
  read-only audit stamp would never reach the UI either. Leave it writable, have
  the route overwrite it from the verified principal (the way a save route
  already owns the id — `entity.id = params.id`), and hide the input with an
  `<EntityField … hidden />` slot. The same applies to `required`: `hiddenFields`
  hides the input and **not its validation rule**, so a hidden required member
  fails validation with no field to show it on and Save does nothing and says
  nothing.
- **A permission is `<domain>:<entityKey>:<action>`**, derived from the entity's
  own `@entity({ domain, key })`. Guard a route with `requirePermission(...)` from
  `@r10c/shells-effect-service` — **hiding a nav item protects nothing** — and
  grants come from `ROLE_PERMISSIONS`, never from the token. `unverifiedClaims`
  reads the cookie **without checking its signature**: nav filtering only, never a
  decision.
- **i18n is mandatory**, and three build gates enforce it: `react/jsx-no-literals`
  fails on a string written into JSX, catalog parity fails on a key present in one
  locale only, and `pnpm nx test @r10c/i18n-check` fails on a service answering
  with a `code` the `errors` catalog lacks. Copy goes through `useT` /
  `getServerT`; runtime keys use the two documented escape hatches
  (`useTranslateKey` / `getServerTranslateKey`), which authored copy must not.
  Note lint is blind to copy inside JSX expressions. See
  [docs/I18N.md](docs/I18N.md).
- **Two documentation facts fail the build, and they fail differently.** A table
  with a machine-readable source is **generated**: `ports-infra`,
  `store-register`, `adr-index` and `adr-triggers` sit between
  `<!-- docs:begin … -->` markers and are written by `node tools/sync-docs.mjs`
  from `infra/local/lib.sh`, `tools/slices/` and the ADR files. Edit the source,
  regenerate, stage — a hand-edit inside a fence fails `--check` in
  `.husky/pre-commit` and in CI. Everything else stays prose and is **asserted**
  by `pnpm nx test @r10c/docs-check`: links and anchors resolve, the router tables
  cover every doc, no business doc names an entity class the source does not
  declare, every bound port is in `ALL_PORTS` and in the port table, every ADR
  carries `- Area:` and `- Read when:`, and every ADR supersession is symmetric.
  Both run **unconditionally** in CI. See
  [DEVELOPING.md → Keeping the documentation true](docs/DEVELOPING.md#keeping-the-documentation-true).
- **ADRs are corrected in place when they go stale.** An ADR's _reasoning_ is
  immutable; its _factual claims_ are not. Fix a false statement where it stands,
  clarify misleading wording in place, and supersede only when the **decision**
  itself no longer holds. Accepted records gain a `- Revised: <date> by [ADR …]`
  line so every edit is greppable, and **supersession is symmetric** — the target
  gets the reciprocal line, or `@r10c/docs-check` fails the build. When a change
  contradicts existing records, grep for the claim rather than guessing which
  mention it. See [docs/adr/README.md](docs/adr/README.md).
- **Four artifacts hold knowledge, one job each — do not merge them.** _How the
  business works_ lives in **Notion** (the `r10c` space, through the Notion MCP
  server); _what we decided and why_ is an **ADR**; _the contract_ is
  `BUSINESS-ARCHITECTURE.md` + `tools/slices/`; _what is next and whether it is
  done_ is a **GitHub issue under a milestone**. Business processes are **not**
  put in `docs/`: the corpus is `docs/*.md` flat files only, so a subdirectory
  gets zero checks, and lifting a process document to the top level hits the check
  that forbids naming what the source does not declare. And the repo is public now
  and private later, which does **not** run backwards — exposure is decided per
  commit, permanently: public law and our own mechanism are committable, our
  commission rates, named vendors and negotiated courier terms are Notion-only.
  [ADR 0025](docs/adr/0025-where-planning-and-business-knowledge-live.md).
- **The business map is a separate document.** Which capability owns an entity,
  which plane it lives in, and the ODA/SID name for it are in
  [BUSINESS-ARCHITECTURE.md](docs/BUSINESS-ARCHITECTURE.md) — read it before
  adding an entity or a domain package, because the domain name is simultaneously
  the package identity, the `@entity({ domain })` value, the permission namespace
  and the organization's entitlement key.

## Decision index

Every architectural decision in this repo is an ADR, and the line beside each one
names the **symptom** that should send you into it — not its subject. Read the
record before designing in its area; a decision re-derived from scratch is how
two answers end up on file.

The lines are generated from each record's own `- Area:` and `- Read when:`
header, so they cannot drift from the ADR they point at. Add a decision by
writing the record with both headers, then `node tools/sync-docs.mjs`.

<!-- docs:begin adr-triggers -->

**Data, stores and tenancy**

- [0006](docs/adr/0006-multitenancy-planes-and-tenant-storage.md) **Multitenancy: three planes, ambient tenancy, storage per organization** — read when deciding which plane an entity lives in, or how a tenant handle is resolved — partly superseded by ADR 0020, 0022 and 0023.
- [0008](docs/adr/0008-domain-modules-and-service-topology.md) **Domain modules, storage ownership, and service topology** — read when tagging a new project — its plane-host topology is superseded by ADR 0020, its tag model is live and fails the build.
- [0011](docs/adr/0011-organization-provisioning-and-migrations.md) **Organization provisioning, migrations, and per-tenant seeding** — read when provisioning an organization, migrating tenant storage, or seeding a new tenant.
- [0013](docs/adr/0013-tenant-storage-on-postgres.md) _(Proposed)_ **Tenant storage on Postgres: schema per organization, one shared pool** — read when putting tenant data in Postgres — schema per organization, one shared pool. Unbuilt.
- [0020](docs/adr/0020-stores-and-slices.md) **Stores and Slices: naming the unit of data ownership and the unit of deployment** — read when adding a store, a database handle or a deployment — a store has exactly one writing slice, and `engine` is not part of its identity.
- [0021](docs/adr/0021-consolidating-the-fleet-into-five-deployments.md) **Consolidating the fleet into five deployments** — read when merging or splitting a deployment — co-deploying two slices is reversible, merging two stores is binding.
- [0022](docs/adr/0022-v1-marketplace-module-boundaries.md) **The v1 marketplace: final domain, store and slice boundaries** — read when adding an entity, a domain or a store — the v1 inventory is fixed, and a `planned` slice must declare no deployment.
- [0023](docs/adr/0023-service-to-service-tenant-crossing.md) **A service reaching tenant storage for another party names the organization explicitly** — read when a service needs tenant data for a party it did not pick — one named path, a service token _plus_ a route permission, no fallback and no operator branch.

**Business, catalog and publication**

- [0005](docs/adr/0005-business-domain-decomposition.md) **Business domain decomposition, named from TM Forum ODA/SID** — read when naming a new domain or moving an entity between domains — a domain name is simultaneously the package identity, the `@entity({ domain })` value, the permission namespace and the entitlement key.
- [0009](docs/adr/0009-catalog-authoring-and-publication.md) **Catalog authoring in the tenant plane, publication into a platform read model** — read when publishing tenant-authored catalog data into the platform plane — publication replaces the projection wholesale.
- [0010](docs/adr/0010-stock-ledger-reservations-and-concurrency.md) **Stock as a movement ledger; purchases reserve rather than decrement** — read when touching stock quantities — a quantity is never read-modify-written, and a purchase reserves rather than decrements.
- [0014](docs/adr/0014-entity-specifications-and-the-characteristic-dictionary.md) _(Proposed)_ **Vendor-authored entity specifications, pinned per instance, comparable through a platform dictionary** — read when letting a vendor author a product model — a released spec version is immutable, and never synthesize an `EntityConstructor` at runtime. Unbuilt.
- [0024](docs/adr/0024-selling-through-a-vendors-own-channel.md) **Selling through a vendor's own channel** — read when an in-store or non-marketplace sale — it is a channel on the same `ProductOrder`, never a second order, and commission resolves through `commissionFor`.
- [0047](docs/adr/0047-authoring-an-offering-and-the-publish-verb.md) **Authoring an offering, and publication as a verb rather than a field** — read when authoring or publishing an offering — `published → published` is legal, and `status` is server-owned or the verb is decoration.
- [0049](docs/adr/0049-the-publication-snapshot-carries-what-the-storefront-renders.md) **The publication snapshot carries what the storefront renders** — read when adding a member to the publication snapshot — optional is a safety property, and an absent member is written absent, never `undefined`.

**Entities and the framework**

- [0026](docs/adr/0026-the-use-case-descriptor-and-served-entity-metadata.md) **The use-case descriptor, and entity metadata as a served document** — read when adding a verb to an entity, or reading affordances in the browser — the descriptor is served from `$metadata` filtered by the verified principal, and an inline descriptor makes every invariant pass vacuously.
- [0034](docs/adr/0034-composition-metadata.md) **Composition metadata: an entity can declare that it owns a collection** — read when an entity member holds an array — `composition`, `linkCollection` and `scalarCollection` are three different relations, and a collection declared sortable throws.

**Frontend, screens and the workspace**

- [0027](docs/adr/0027-two-scales-a-density-mode-and-the-type-system.md) **Two scales, a density mode, and the type system** — read when changing spacing, type scale, density or elevation — one token set with two scales, and a `@theme` shadow is baked at build time rather than referenced.
- [0032](docs/adr/0032-what-may-live-in-an-autosaved-draft.md) **What may live in an autosaved draft** — read when putting anything into an autosaved draft — JSON round-trippable only, ids in the draft with instances beside it, and the key is scoped per principal.
- [0033](docs/adr/0033-the-screen-taxonomy.md) **The screen taxonomy: Definiciones, Operaciones, Asistentes, Consultas** — read when adding a screen — four types, and a verb on a record is not grounds for a fifth.
- [0035](docs/adr/0035-entity-actions-selection-and-bulk.md) **Entity actions: where a verb appears, and what a bulk action acts on** — read when declaring where an action appears, or acting on a selection — nine cells, every one mapped or rejected, and two select-alls are two state shapes.
- [0037](docs/adr/0037-entitlement-aware-navigation.md) **Entitlements ride the access token, and navigation reads them** — read when a nav item should disappear for an unprovisioned organization — `entitled: true` opts in, and the skip is keyed on `activeOrganizationId`, never on an empty list.
- [0038](docs/adr/0038-master-detail-the-rows-a-record-owns.md) **Master-detail: a record and the rows it owns, edited in one write** — read when editing the rows a record owns — the draft grew a second shape, and a random row key hangs React.
- [0040](docs/adr/0040-the-record-search-aggregator.md) **The record search aggregator fans out per request and ranks nothing** — read when searching records across services — no client-side index, ever, and a source's search member is validated at module load.
- [0041](docs/adr/0041-the-sidebar-renders-the-taxonomy.md) **The sidebar renders the taxonomy, and a shell may ask about the viewport** — read when rendering navigation — type › domain › destination, and auto-collapse must never write the stored preference.
- [0042](docs/adr/0042-the-workspace-address-is-the-taxonomy-serialized.md) **The workspace address is the taxonomy serialized** — read when addressing a workspace tab — `master:<key>[:<id>]` is one grammar, and both version constants bump when it changes.
- [0043](docs/adr/0043-the-optimistic-mutation-contract.md) **The optimistic mutation contract, and reconciliation is a re-query** — read when a write answers `202` — the browser keeps watching, and a `404` from the tracker means not-tracked-yet, never failed.
- [0044](docs/adr/0044-the-command-palette.md) **The command palette owns no index, and its depth is a page stack** — read when adding anything to the command palette — the sources filter and the control renders, and matching is accent-folded because the default locale is Spanish.
- [0045](docs/adr/0045-the-wizard-a-step-graph-and-a-submit-that-hands-off.md) **The wizard: a step graph, a draft above the forms, and a submit that hands off** — read when building a multi-step screen — the step graph is data, Back pops a history stack, and a validation gate belongs to a step.
- [0051](docs/adr/0051-the-storefront-reads-the-projection.md) **The storefront reads the projection** — read when the storefront reads or renders catalog data — nothing is enumerated at build time, and a failed read renders an empty catalog and logs.

**Messaging, transactions and sagas**

- [0028](docs/adr/0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md) **The transaction id is the client's, and its event ships with the write** — read when a create goes through the transaction engine — the client mints the id, that id is the idempotency key, and the event is written to the outbox inside the same Mongo transaction.
- [0029](docs/adr/0029-the-event-envelope-and-a-routed-bus.md) **The event envelope, and a bus that routes** — read when publishing or subscribing to a bus message — `meta` describes the message and `data` the occurrence, and the dedup key is `event.id`.
- [0030](docs/adr/0030-failure-retry-and-quarantine-on-the-bus.md) **Failure, retry and quarantine on the bus** — read when a handler fails or a payload cannot be parsed — three failure classes, `work` versus `broadcast`, and `x-delivery-limit` is immutable once the queue exists.
- [0036](docs/adr/0036-the-reactive-stream-is-server-sent-and-same-origin.md) **The reactive stream is server-sent, same-origin, and scoped per connection** — read when pushing anything to a browser — SSE and not a socket, because the cookie is `httpOnly` and the `WebSocket` constructor accepts no headers.
- [0039](docs/adr/0039-multi-step-sagas-are-orchestrated.md) **Multi-step sagas are orchestrated, per flow, from a declarative definition** — read when a flow spans slices — orchestrated per flow, commands over HTTP and results over the bus, with a stated condition for adopting a workflow engine instead.
- [0048](docs/adr/0048-announcing-a-publication.md) **Announcing a publication, and a shared contract to announce it with** — read when emitting or consuming a publication — the projector orders on `publishedAt`, and an unpublication leaves a tombstone because a delete has nothing to be ordered by.
- [0050](docs/adr/0050-rebuilding-the-published-catalog-from-tenant-storage.md) **Rebuilding the published catalog from tenant storage** — read when the storefront is empty after a reset, or a publication was lost — the rebuild walk re-emits from tenant storage and must never stamp `now`.
- [0052](docs/adr/0052-the-checkout-saga.md) **The checkout saga: a definition that is data, and a compensation that is told what it undid** — read when a flow spans two services and one of them may have to be undone — the definition is data, a fan-out step compensates only the calls that succeeded, and a participant the saga may retry must be idempotent on the command id.

**Identity, sessions and authorization**

- [0002](docs/adr/0002-authorization-roles-and-abac.md) **Authorization: role aspects behind an ABAC-shaped port** — read when guarding a route, adding a permission, or deciding what a token may carry — grants come from `ROLE_PERMISSIONS`, never from the token, and hiding a nav item protects nothing.
- [0004](docs/adr/0004-session-lifetime-devices-and-recovery.md) **Session lifetime, device identity, and account recovery** — read when changing a session duration, a cookie lifetime or a device record — sessions slide under a ceiling, and sizing `r10c_at` to the token signs everyone out every 15 minutes.
- [0007](docs/adr/0007-access-model-planes-roles-entitlements.md) **Access model: planes, platform roles, tenant-defined roles, entitlements** — read when granting a role or provisioning an organization — two ceilings, what a role may assign and what the organization was provisioned for.
- [0012](docs/adr/0012-operator-cross-tenant-access.md) _(Proposed)_ **Operator cross-tenant access is an audited crossing, never a bypass** — read when designing any operator cross-tenant read — a _discretionary_ crossing needing a human's permission, a time box and a `Crossing` record, which is not ADR 0023's determined one. Unbuilt.
- [0015](docs/adr/0015-asymmetric-access-tokens-and-the-party-role-claim.md) **Asymmetric access tokens, and the party role as a claim** — read when touching token minting or verification — RS256 with `algorithms` pinned is the security boundary, and `partyRole` is routing context, never a grant.
- [0016](docs/adr/0016-zitadel-authenticates-r10c-authorizes.md) **Zitadel authenticates; r10c authorizes and mints its own tokens** — read when anything touching sign-in, credentials, lockout or account recovery — there is no password here to reset or to guess, and each field has one writer.
- [0017](docs/adr/0017-back-channel-logout-from-the-identity-provider.md) **Back-channel logout: the provider can end an r10c session** — read when changing sign-out or session revocation — the reverse direction needs the `oidc:sid` index and its own verifier, whose missing-`nonce` check is what makes it safe.
- [0019](docs/adr/0019-provider-user-lifecycle-events-revoke-sessions.md) **A user deactivated at the provider loses their r10c sessions** — read when a user deactivated at the provider keeps refreshing — the seam is an Actions v2 execution authenticated by HMAC, and the signing key is minted once and never served again.

**Platform, observability, docs and conventions**

- [0001](docs/adr/0001-observability-and-tooling.md) **Observability & platform tooling** — read when adding a service to the observability pipeline, changing a log level or sink, or adding a metric or a Grafana panel — the Effect→tooling bridge silently emitted every log at `info` and discarded every annotation, and a declared metric name is not its Prometheus name.
- [0003](docs/adr/0003-i18n-mandatory.md) **i18n is mandatory, and the build enforces it** — read when writing user-visible copy, adding an error `code`, or adding a locale binder — three build gates make i18n mandatory, and a code missing from the catalog reaches the user raw.
- [0018](docs/adr/0018-the-hosted-login-is-a-second-container.md) **The hosted login is a second container** — read when the sign-in page 404s behind green probes — the hosted login is a second container on `:30081`, applied at ladder rung L6 and pointed at by the seed at L7.
- [0025](docs/adr/0025-where-planning-and-business-knowledge-live.md) **Where planning and business knowledge live** — read when deciding where a process, a decision, a contract or a plan belongs — four artifacts with one job each, and the repo's exposure is decided per commit, permanently.
- [0031](docs/adr/0031-a-service-describes-its-own-wiring.md) **A service describes its own wiring** — read when adding a datastore, a queue binding or an upstream to a service — `/api/$service` diffs what a service does against what the register declares.
- [0046](docs/adr/0046-conventions-are-checked-not-stated.md) **A convention that is only stated is a convention that gets skipped** — read when adding a working convention, or wondering why attribution trailers keep reappearing — a convention that is only stated is one that gets skipped.

<!-- docs:end adr-triggers -->
