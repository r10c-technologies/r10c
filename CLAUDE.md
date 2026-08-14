# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository. This file is a
**router**: the operational essentials below are `@import`ed from single-source
snippets in `docs/_shared/` (so they can never drift from the docs that also use
them), and everything deep is a link — loaded only when a task needs it.

## Documentation map

| Doc                                                            | When you need it                                                                                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                   | Layering, the use-case + adapter mechanism, Effect-native backends, auth, transactions, observability, domain structure.            |
| [docs/BUSINESS-ARCHITECTURE.md](docs/BUSINESS-ARCHITECTURE.md) | The **business** side: capability map, ODA/SID glossary, personas as party roles, data planes, catalog publication, stock rules.    |
| [docs/ENTIFIX.md](docs/ENTIFIX.md)                             | The entity framework in depth: entities, links, the Effect-agnostic use-case, adapter contract, the RSQL query protocol.            |
| [docs/FRONTEND.md](docs/FRONTEND.md)                           | The client side: design system (tokens, flex-first layout primitives, Storybook) **and** the workspace tabs + TanStack data layer.  |
| [docs/I18N.md](docs/I18N.md)                                   | Locales, catalogs, locale routing, entity label keys, error codes, and the three gates that make i18n mandatory.                    |
| [docs/DEVELOPING.md](docs/DEVELOPING.md)                       | Nx/pnpm workspace, commands, local infra, **module boundaries**, entities, backends, testing (`E2E_PROFILE`), conventions, commits. |
| [docs/adr/](docs/adr/)                                         | Architecture Decision Records (e.g. [0001 observability & tooling](docs/adr/0001-observability-and-tooling.md)).                    |

`docs/_shared/` holds the small snippets imported below; edit the snippet, not the copies.

## Tooling & commands

@docs/_shared/commands.md

## Layering & module boundaries

@docs/_shared/layering.md

## App & port convention

@docs/_shared/ports.md

## Stores, slices & data planes

@docs/_shared/planes.md

## Notes for code changes

- **Nothing runs in production.** Every environment is a local dev fleet, and
  infrastructure and data are recreated on demand (`pnpm run <app>:dev:reset`).
  So **do not design for backward compatibility** — no dual-read windows, no
  legacy fallbacks, no migration shims, no compatibility flags — unless the user
  explicitly asks for a staged swap. Change the seed, change the shape, and
  reset. A compatibility path written "just in case" is dead code that has to be
  maintained and reasoned about at every later step, and some of them (a verifier
  that branches on a token's `alg`, say) open a security surface a hard cut never
  opens.
- **Boundaries are enforced.** Imports must point downward and stay in-scope; the
  `@nx/enforce-module-boundaries` rule (driven by each project's `nx.tags`) fails
  the build otherwise. A new project needs `layer:`/`scope:` (and `entifix:` under
  `packages/entifix`, `business:` under `packages/business`, `shell:` under
  `packages/shells`, `host:` for an app) tags. To make an edge legal, retag —
  never weaken the rule. The dimensions and the forbidden couplings are
  [ADR 0008](docs/adr/0008-domain-modules-and-service-topology.md)'s live half:
  its plane-host topology was superseded by ADR 0020, its tag model was not.
  See [DEVELOPING.md → Module boundaries](docs/DEVELOPING.md#module-boundaries).
- **Data ownership has two nouns: `Store` and `Slice`.** A **Store** is a named
  persistence boundary with exactly one writing slice, one plane, and an identity
  independent of the engine backing it; a **Slice** owns Stores and is the unit of
  physical split (`Domain → Store → Slice → Deployment`). Three invariants: a
  domain's entities live in exactly one Store, a Store has exactly one writing
  Slice, and two domains sharing a Store are **permanently co-deployed** — a
  binding decision that must be recorded in the register, not discovered
  mid-split. `engine` is not identity, so one Redis may host two Stores but a
  Store never spans engines; and a Next app belongs to no Slice, because it owns
  no Store. A projection is not an exception to any of this — it is a Store
  carrying `truth: projection-of:<store>`, which is what makes ADR 0009's
  published catalog and ADR 0012's cross-tenant reporting the same shape. This
  supersedes ADR 0008's plane-host topology: the axis is ownership, not plane,
  because a slice may own stores in several planes. See
  [ADR 0020](docs/adr/0020-stores-and-slices.md) and the register in
  [planes](docs/_shared/planes.md). The register is **executable**:
  `tools/slices/` declares it and `pnpm nx test @r10c/slices` fails the build on
  a domain hosted by two stores, a store claimed by two slices, or an app that
  opens a datastore no slice declares. Edit a `*.slice.ts` first; the doc mirrors
  it.
- **Co-deploying two slices is reversible; merging two stores is binding.** The
  fleet runs five deployments, not eight: `marketplace-service` was deleted (no
  router, no store, no domain — not a Slice), the `transaction` slice is
  co-deployed inside marketplace-admin-service, and auth-app merged into
  `back-office-app`. Ownership never moved — each slice still writes only its own
  stores, `coDeployedWith` records the sharing on **both** sides, and splitting
  back out means pointing `deployments` at a new app. The test to apply before
  any further merge: can you still name the one slice that writes each store,
  without reading code? `config-service` (the boot dependency), `auth-service`
  (Zitadel's callback target) and `marketplace-app` (prerender + ISR, and the
  only host that sees anonymous traffic) stay standalone on purpose. See
  [ADR 0021](docs/adr/0021-consolidating-the-fleet-into-five-deployments.md).
- **The v1 boundaries are locked, and the register knows about slices that do not
  run yet.** [ADR 0022](docs/adr/0022-v1-marketplace-module-boundaries.md) fixes
  11 domains, 28 entities, 12 stores, 9 slices, 6 deployments. A
  `SliceDeclaration` carries `status: 'active' | 'planned'`: **planned records
  ownership before a process exists**, is held to all three invariants, and must
  declare **no** deployment — a handle opened for a store nothing writes is the
  phantom store ADR 0020 deleted `marketplace_admin` for. Promote a slice in the
  commit that writes its store, never earlier; the spec fails both ways. Four
  boundary calls worth not re-deriving: `ProductBrand`/`ProductCategory`/
  `DictionaryTerm` are **platform-plane** `catalog-reference`, because a
  marketplace has to merge and per-vendor taxonomy cannot; that domain is
  **never entitlement-grantable**, which is the first exception to ADR 0007's
  ceiling; `catalog` and `stock` are two tenant stores in **two** databases
  (`tenant_<id>`, `stock_<id>`) so one-writer is a property of the handle; and
  the `marketplace` slice writes `published-catalog` by **consuming**
  `catalog.published`, not the slice that authored the offering — which is what
  keeps the public read host out of tenant storage. SID's `Product` is the
  instance a buyer owns, in `order-management`; the catalog record is
  `ProductSpecification`.
- **A service may name a tenant explicitly — one path, and it is authorized.**
  Checkout is platform-plane and must reserve tenant-plane stock, but a buyer's
  session carries no organization: the vendor comes from the _item_. So
  `TenantContextTag` has a second provider — an explicit `organizationId` plus a
  service token **and** a narrow route permission
  ([ADR 0023](docs/adr/0023-service-to-service-tenant-crossing.md)). No third
  path, no fallback, no operator branch. The token is **not**
  `CONFIG_SERVICE_TOKEN` — reusing it would turn one leaked secret into a
  tenant-data write across every organization — and fleet membership is not a
  capability, so the permission is the actual authorization. Do **not** confuse
  this with ADR 0012's crossing: that one is _discretionary_ (a person picks an
  organization, so it needs a human's permission, a time box and a `Crossing`
  record), this one is _determined_ (the organization is a function of the item).
  Residual, recorded: a shared secret means any holder can name any org.
- **ADRs are corrected in place when they go stale.** An ADR's _reasoning_ is
  immutable; its _factual claims_ are not. Fix a false statement where it stands,
  clarify misleading wording in place, and supersede only when the **decision**
  itself no longer holds — the policy is
  [ADR 0022](docs/adr/0022-v1-marketplace-module-boundaries.md)'s, and it trades
  away the ability to reconstruct what people believed at the time. Accepted
  records gain a `- Revised: <date> by [ADR …]` line (or `- Amended by:`) so every
  edit is greppable from the header. **Supersession is symmetric**: when a record
  claims it supersedes or amends another, the target gets the reciprocal line —
  recording it only forward is how ADR 0004 kept describing a password-reset flow
  that ADR 0016 had deleted, under `Status: Accepted` with no marker.
  `pnpm nx test @r10c/docs-check` fails the build on a one-way claim. When a change
  contradicts existing records, grep for the claim rather than guessing which
  mention it — ADR 0014 stated the dictionary's owner in three separate places —
  and check each Proposed record's own `## Trigger` before promoting it.
  See [docs/adr/README.md](docs/adr/README.md).
- **Two documentation facts fail the build, and they fail differently.** A table
  with a machine-readable source is **generated**: `ports-infra`,
  `store-register` and `adr-index` sit between `<!-- docs:begin … -->` markers
  and are written by `node tools/sync-docs.mjs` from `infra/local/lib.sh`,
  `tools/slices/` and the ADR files. Edit the source, regenerate, stage — a
  hand-edit inside a fence fails `--check` in `.husky/pre-commit` and in CI.
  Everything else stays prose and is **asserted** by
  `pnpm nx test @r10c/docs-check`: links and anchors resolve, the router tables cover every
  doc, no business doc names an entity class the source does not declare, every
  bound port is in `ALL_PORTS` and in the port table, and every ADR supersession
  is symmetric. Both run **unconditionally** in CI, like the i18n catalog check
  and for the same reason — a doc claim is everyone's problem, not the affected
  projects'. `tools/docs/staleness.mjs` is the advisory third: it reports code
  that changed without its docs being touched, into the job summary, and never
  blocks, because "not edited" is not "wrong". See
  [DEVELOPING.md → Keeping the documentation true](docs/DEVELOPING.md#keeping-the-documentation-true).
- **The business map is a separate document.** Which capability owns an entity,
  which plane it lives in, and the ODA/SID name for it are in
  [BUSINESS-ARCHITECTURE.md](docs/BUSINESS-ARCHITECTURE.md) — read it before
  adding an entity or a domain package, because the domain name is simultaneously
  the package identity, the `@entity({ domain })` value, the permission namespace
  and the organization's entitlement key. The decomposition itself, and why the
  names come from TM Forum ODA/SID, is
  [ADR 0005](docs/adr/0005-business-domain-decomposition.md). Decisions already
  reasoned through but not yet built are **Proposed** ADRs (operator cross-tenant
  access, Postgres tenancy, vendor-authored entity specifications); read the
  relevant one before designing in that area rather than re-deriving it.
- **A vendor's product model is data, not a commit.** A vendor authors a versioned
  `EntitySpecification`; an offering pins the version it was written under, and a
  released version is immutable — which is what lets a compiled-spec cache never
  invalidate, removes any need for a cross-store transaction, and lets publication
  dedupe a spec by content hash. This does **not** replace entifix metadata: the
  spec entities are themselves `@entity()`-decorated classes, the skeleton
  (`ProductOffering`) stays typed, and the only framework change is `EntityForm`
  accepting `fields: EntityFieldDescriptor[]` beside `entityConstructor`. Never
  synthesize an `EntityConstructor` at runtime, write `Symbol.metadata` outside a
  decorator, branch on specs inside `packages/entifix`, or route a characteristic
  into the RSQL allowlist. Cross-vendor comparability comes from a platform-owned
  dictionary of terms (code + value set + unit) a characteristic may resolve to —
  vendors narrow a term's values, never widen them. See
  [ADR 0014](docs/adr/0014-entity-specifications-and-the-characteristic-dictionary.md).
- **Inject with Effect.** Wire dependencies as `Context.Tag` subclasses provided via
  `Layer`, not instances through constructors — a missing dep is a compile error.
- **Entities describe themselves.** Private `#field` + `@accessor()` getter/setter
  (a field without a getter is invisible to adapters). Pass `type`/`label` (and
  `sortable`/`filterable`/`hidden` where they differ from defaults). A member's
  `filterable`/`sortable` metadata is also the **server-side allowlist** — a query
  naming a member that lacks it is rejected `400`, so making a member queryable is a
  one-line change on the entity and nowhere else. See [docs/ENTIFIX.md](docs/ENTIFIX.md).
- **A relation's wire shape is metadata, and its editor is a port.** `@accessor({
type: 'link', linkSerialization: 'embedded' })` (default `'id'`) is what decides
  whether a link writes back inlined or as a foreign key — the serializer inlines
  whatever `isLoaded`, so without the declaration the shape would depend on whether
  the UI happened to hold the target. `applyEntityLinks` (core, pure) applies it at
  submit. A form draft stays `Record<string, string>` because a workspace autosaves
  it, so **ids are the truth and picked instances are a sidecar** (`useEntityForm`'s
  `links`/`setLink`) — a missing entry costs the embedded shape, never the relation.
  The editor itself is split by the boundary rule: `entifix-react-controls` ↮
  `entifix-react-integration` (both `entifix:react`), so `EntityLinkInput`/
  `EntityLinkPicker` are presentational and meet `useEntityLinkSource` at the
  framework-free `EntityLinkSource` port in **core**. `EntityForm` takes
  `linkSources` keyed by accessor name; one hook call per relation lives in the
  entity-tight wrapper (React's hook count must stay fixed). A picker's
  `linkSearchProperty` must be `filterable` on the **target** or the service answers
  `400` — the hook throws instead. To-many (`linkCollection`) is not editable yet.
- **Adding a filter operator** touches four places or it half-works: the const
  arrays in `core/types/EntityFiltering.ts`, the token map in
  `core/src/rsql/rsql-operators.ts`, `mongo-client`'s `filter-translator.ts`, and
  `sql-client`'s `sql-filter-translator.ts`. Both translators keep an
  exhaustiveness guard (`const _never: never = node`), so a missed one is a compile
  error rather than a silent match-all; the core round-trip spec
  (`serialize → parse → coerce` equals the original) catches a partial addition.
- **Backend DB adapters**: a `-service` provides `EntityRepositoryTag` from
  `makeMongoRepository(db, Ctor)` — or `makeSqlRepository(sql, Ctor)` from
  `@r10c/entifix-ts-sql-client` for Postgres — runs the SAME `*UCFactory`
  use-cases, then the envelope builders (`makeEntityEnvelope` /
  `makeEntityPageEnvelope`) for the response.
  **An accessor's `alias` is its SQL column**: `serializeEntity` keys its plain
  record by `alias ?? name` in both directions, so a scalar entity's serialized
  form already _is_ a table row and there is no mapping layer to write. The SQL
  filter translator emits parameterized fragments only, and validates every
  column identifier against the entity's `filterable`/`sortable` allowlist before
  interpolation — that check is the file's security boundary, not a nicety.
  Add native drivers
  (`mongodb`, `@effect/sql*`) to `webpack.config.js` `externalDependencies`, keep
  `tslib` external, and align `@effect/sql*` with the pinned `@effect/platform`. See
  [[backend-db-connectivity]] and [docs/ENTIFIX.md](docs/ENTIFIX.md).
- **A library edit reloads everywhere, by two different mechanisms.** A `-service`
  consumes workspace packages as **source** via `resolve.conditionNames`
  (`@r10c/source`) in its `webpack.config.js`, and `@nx/js:node` rebuilds and
  restarts it on a dependency edit. The Next apps **cannot** declare that
  condition — Turbopack has no `conditionNames` knob and Next's swc only parses
  decorators in the legacy `experimentalDecorators` emit, which would break the
  stage-3 `Symbol.metadata` entity decorators — so they resolve `import` →
  **`dist`**, and `tools/watch-libs.sh` keeps `dist` fresh: **one** watcher
  (`watch-libs` on the root project, `dependsOn` of every app `dev`, so Nx dedupes
  it to a single process) rebuilds the changed library in ~3-5s and Turbopack
  picks it up. Per-app `watch-deps` is what you must NOT wire — an app `dev`
  chains the services it needs, so two watchers double-build every shared library. A
  manual `pnpm nx build <lib>` is only needed when no app is running. Service `build`
  targets must keep **`dependsOn: []`**: with the inferred `^build`, every
  rebuild forked `nx run <service>:build`, re-entered a lib build already in the
  parent chain, and Nx killed the service with
  `Recursive task invocation detected`. `^production` in `inputs` is what keeps
  the cache honest, not `^build`.
- **Liveness never checks a dependency.** Every app and service answers
  `/api/health` (unchanged), `/api/health/live` and `/api/health/ready`.
  Liveness is process-only _by design_ — a liveness probe that fails on a Mongo
  blip is how Kubernetes gets told to restart a healthy fleet. Readiness is
  `200` / `503 {status:'degraded',failing:[…]}` with probe **names** only (the
  endpoint is unauthenticated), cached ~1s so it cannot become a free lever on
  the datastore, and each probe is deadlined in the registry — a driver that
  queues while disconnected (ioredis) otherwise leaves readiness _hanging_ at
  the one moment it must answer. Backend probes register themselves from the
  client layers (`MongoHealthProbeLayer` &co. + `HealthRegistryTag` from
  `@r10c/entifix-ts-business`), so a service that gains a datastore gains its
  probe; a service `AppLayer` merges the probe layer, `makeServerLayer`
  provides the registry. App readiness checks **only** its own config — never
  chain to a backend, that turns one degraded service into a fleet outage.
- **Dev ports self-clear.** Every app/service `dev` depends on `free-ports`
  (`tools/free-ports.sh <port>`), which kills a leftover listener from a previous
  run — but **only** a process running from inside this repo (cwd/argv under the
  repo root); a foreign listener is reported and the target fails rather than
  killing something that is not ours (`R10C_FREE_PORTS=force` overrides). Ports
  live in `ALL_PORTS` there and in [ports](docs/_shared/ports.md); a new domain
  adds its `300N`/`310N` to both.
- **Local dev self-heals.** `pnpm run back-office:dev` walks the ladder in
  `infra/local/ensure.sh` (cluster → kubecontext → port mapping → workloads →
  rollout → probes) and fixes the broken rung; it never deletes data and never
  recreates the cluster, exiting with the `reset.sh` command instead.
  `pnpm run back-office:dev:reset` is the destructive heal — it wipes the
  namespace, PVs **and** hostPaths so the services re-seed on boot, which is
  the only way a drifted seed row gets corrected (the seed is
  `INSERT … ON CONFLICT DO NOTHING`). Ports/namespace/probes live once in
  `infra/local/lib.sh`. A published NodePort answering TCP is **not** health —
  docker-proxy and kube-proxy keep it open both _after_ the pod is gone and
  _before_ the datastore's listener exists — so the ladder pairs TCP with
  deployment readiness, and **every `infra/local/*` deployment must declare a
  protocol-level `readinessProbe`** (AMQP, `pg_isready`, an authenticated redis
  `PING`, a mongo `ping`). Without one, `readyReplicas` only means "container
  started", ensure green-lights a booting fleet, and a service that dials
  RabbitMQ at boot exits `1`. L3 re-applies the manifests on **every** heal (a
  deployment existing says nothing about it matching git), which is why the
  PVC-backed datastores need `strategy: Recreate` — a rolling update starts the
  replacement while the old pod holds the data dir's lock (`DBPathInUse`). Two
  drift traps the ladder now owns: Docker Desktop republishes the apiserver on a
  new host port each restart, so a stale kubeconfig makes a healthy cluster read
  as unreachable (heal is `minikube update-context`, ~2s, not a 2-min
  `minikube start`); and `.heal.lock` records its owner pid, so a Ctrl-C'd run's
  lock is broken at once instead of stalling the next boot for ten silent
  minutes. `pnpm run dev-infra:doctor` diagnoses read-only.
- **Config**: services read cross-service config from **config-service** (Postgres,
  seeded in `apps/config-service/src/db.ts`); never hardcode a URL/connection string.
  Every service exposes `GET /api/config` (own params, secrets redacted via
  `redactConfiguration`). That endpoint is **unauthenticated**, so redaction is a
  security boundary, not diagnostics polish: it blanks any item whose `isSecret`
  flag config-service propagated from its `is_secret` column. Masking only the
  `user:pass@` of a URI was not enough — `jwt.privateKey` is not a URI, and the
  old `jwt.secret` was served in full. A new credential row must set
  `is_secret: true` or it is public. The seed is `ON CONFLICT DO NOTHING`, which
  is what makes editing a value through the CRUD safe — the next boot leaves it
  alone.
  config-service also serves the operator CRUD at `/api/configuration…` behind
  `config:configuration:*`; secrets are **write-only** (blanked on read, preserved
  on a blank write, and the flag cannot be cleared without a new value) and every
  write appends to `configuration_audit` in the same transaction. The fleet lookup
  is gated on `X-Service-Token` — it serves real credentials and cannot redact
  them. **Every caller of that endpoint sends it, and a probe is a caller**:
  `shells-effect-service/load-remote-configuration.ts` on a service's boot, and
  in `shells-next-common` both `createConfigRoute` and the readiness probe, which
  share `lib/config/service-token.ts` for exactly that reason — a readiness check
  that omits the header reads the `401` as `degraded` and the app never becomes
  Ready while being perfectly healthy. That is fleet membership, not service
  identity; the health endpoints themselves stay open. config-service reads its
  own `jwt.publicKey`/`jwt.keyId` via SQL, never over HTTP from itself — and only
  the public half, since it verifies tokens and never mints them.
- **Transactions**: a `-service` with transactional writes provides the ports from the
  Redis/AMQP layers in its `AppLayer` and resolves `redis.uri`/`rabbitmq.uri` from
  config-service; add `ioredis`/`amqplib` to `externalDependencies`. The domain half is
  a `TransactionHandler` closing over its deps. See [[entifix-transactions-phase1]] and
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#transactions-cqrs-writes).
- **Zitadel authenticates; r10c authorizes.** auth-service holds **no credential** —
  no hash, no lockout ledger, no `PasswordHasher`, and no `AccountRepository`
  method that could read or write one. Sign-in is authorization code + PKCE
  against Zitadel's hosted UI: `POST /api/auth/oidc/start` mints the PKCE pair and
  stashes `{codeVerifier, nonce, redirect}` under a one-time token that **is** the
  `state`; `POST /api/auth/oidc/callback` consumes it (that consumption is the CSRF
  _and_ replay check), verifies the `id_token` with `algorithms` pinned, resolves
  the `sub` to a `UserIdentity` — provisioning one at `role: user` on first sight —
  and then runs the unchanged `establishSession`. **One writer per field**: Zitadel
  owns email/displayName/verified and the local rows are projections refreshed on
  every callback; r10c owns `role`, `status`, party, devices and sessions.
  Provisioning is local-first with **repair on retry**, deliberately not a saga —
  a failed provider write leaves an account with no `external-subject` that cannot
  sign in and is fixed by re-submitting. Sign-out must navigate to the returned
  `endSessionUrl` or the visitor stays authenticated at the provider. MFA and
  social are configuration in `tools/zitadel-seed.mjs`, available to all and forced
  on nobody. See [ADR 0016](docs/adr/0016-zitadel-authenticates-r10c-authorizes.md).
- **Sign-out runs both ways, and the reverse one needs an index.**
  `POST /api/auth/backchannel-logout` is Zitadel telling us a session it owns
  ended; without it an r10c session outlived a provider sign-out by up to its
  seven-day ceiling while `refresh` kept minting. Our session id is our own, so
  the callback records the verified `id_token`'s `sid` into `oidc:sid:{sid}` — a
  Redis **set**, because one provider session can open several of ours, and
  written from the id_token only (a userinfo-supplied `sid` would pick whose
  sessions die). The route is unauthenticated by necessity and the signature is
  the authentication: `verifyLogoutToken` shares **one** pinned-`algorithms`
  verifier with the id_token path — never add a second — then requires the
  back-channel `events` claim, a `sub` or `sid`, and **no `nonce`**; that last
  check is what stops a stolen `id_token` being POSTed here, and it is why the
  two verifiers stay separate functions. A `sid` revokes exactly its sessions; a
  `sub`-only token _or an empty set_ (which is what a lost link write looks like)
  falls back to `revokeAllForUser`. Unknown ids answer `200` — a `404` makes the
  endpoint an oracle. `refresh` stays store-only: re-checking `UserStatus` there
  would not close a Zitadel-side deactivation, because deactivating there never
  writes r10c's `status`. The seed registers the URI at
  **`host.minikube.internal:3102`**, not `localhost` — Zitadel calls it from
  inside the cluster. And `ZITADEL_SEED_REVISION` in `infra/local/lib.sh` must be
  bumped with any seed change that adds a setting: the L7 guard is a cache key,
  and `ensure.sh`'s fast path exits before the seed rung is reached, so without a
  bump the change reaches only machines that happened to reset. See
  [ADR 0017](docs/adr/0017-back-channel-logout-from-the-identity-provider.md).
- **A logout token covers a session ending, never a user ending.** Measured:
  deactivating a user in Zitadel fires _nothing_, so the r10c session kept
  refreshing to its seven-day ceiling. The seam is an **Actions v2 event
  execution** — `user.deactivated` / `user.locked` / `user.removed` → one
  `restAsync` target → `POST /api/auth/provider-events`, which resolves
  `aggregateID` (the `sub`) through `findByIdentifier` and calls
  `revokeAllForUser`. Unauthenticated by necessity again, and here the
  authentication is an **HMAC**, not a JWT: `ZITADEL-Signature: t=…,v1=…` over
  `"<t>.<raw body>"`, 300s tolerance — hence `req.text` (a reserialised object is
  different bytes) and hence its own module, since the OIDC verifier's whole
  point is that it accepts no symmetric key. An empty key **fails closed**. Do
  **not** write `UserIdentity.status` from the event: nothing projects status
  back from Zitadel, so a local `disabled` would outlive a provider reactivation
  forever. The trap is the key itself — Zitadel mints it inside `CreateTarget`
  and never serves it again, while config-service seeds `ON CONFLICT DO NOTHING`,
  so `ensureActionTarget` **carries it forward** from the previous
  `.generated.env` and only mints a new one when there is no target. An event
  fired while auth-service is down is lost; that is the known residual gap. See
  [ADR 0019](docs/adr/0019-provider-user-lifecycle-events-revoke-sessions.md).
- **The hosted login is a second container.** Zitadel v4's login is a separate
  Next.js image the core does not serve, so the lab runs `infra/local/zitadel-login`
  on its own NodePort **30081** and the seed sets `loginV2.required` +
  `baseUri: http://localhost:30081/ui/v2/login/`. Get the order wrong and you get
  the one failure a health ladder cannot see — a 404 sign-in behind green probes —
  which is why the login is **L6** and the seed that points at it is **L7**, and
  why `ensure.sh`'s fast path asks `login_ready`. `zitadel-login` is deliberately
  not in `PLATFORMS` (L3 applies that list before the token exists). The token is
  an `IAM_LOGIN_CLIENT` PAT Zitadel writes at **first-instance init**
  (`ZITADEL_FIRSTINSTANCE_ORG_LOGINCLIENT_*`), extracted through the `pat-reader`
  sidecar into `zitadel-login-secret` — so an instance older than that setting
  never grows the user and the only fix is `dev:reset`. Nothing above the OIDC
  boundary changed: `oidc-client.ts` reads every URL from discovery. The e2e
  fixture does — `seedSession` switches on v2's **routes** (`/loginname`,
  `/password`, `/mfa/set`, `/accounts`), because v2 reuses `data-testid`s across
  screens (`reset-button` is both "Reset password" and "Skip"). See
  [ADR 0018](docs/adr/0018-the-hosted-login-is-a-second-container.md).
- **Auth**: auth-service owns `oidc/start`/`oidc/callback`/`logout`/`refresh` and
  returns JSON;
  each `-app` mints its own `r10c_sid`/`r10c_at` httpOnly cookies. A backend authorizing
  a request verifies `r10c_at` statelessly via `TokenServiceTag` (no Redis/auth round
  trip on the hot path). Tokens are **RS256**: auth-service alone resolves
  `jwt.privateKey`, everyone else gets `jwt.publicKey` + `jwt.keyId` and cannot
  mint. `verifyAccessToken` pins `algorithms: ['RS256']` — that line is the
  security boundary, because jose otherwise trusts the token's own `alg` and the
  public key (served openly at `/.well-known/jwks.json`) would pass as an HMAC
  secret. A session also carries `partyRole` (`customer`/`vendor`/`operator`),
  resolved once at sign-in by `SessionScopeResolver` and re-signed unchanged on
  refresh; it is routing context, never a grant, and it exists because an absent
  `activeOrganizationId` means _both_ a buyer and an operator. Nothing branches on
  it yet. See [ADR 0015](docs/adr/0015-asymmetric-access-tokens-and-the-party-role-claim.md),
  [[auth-layer-v1]] and
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#auth-sessions--tokens).
- **Sessions slide under a ceiling**
  ([ADR 0004](docs/adr/0004-session-lifetime-devices-and-recovery.md), the half of
  that record ADR 0016 left standing)**.** Every duration lives in
  `business-ts-authn/values/session-policy.ts` — edit there, nowhere else. Both
  cookies are sized to the **session**, never to the token (sizing `r10c_at` to
  `expiresIn` is what signed everyone out every 15 min). `touch` clamps to
  `absoluteExpiresAt`. What slides a session is _user_ activity: `requirePrincipal`
  must stay stateless, so the browser's `useSessionRefresh` stops refreshing when
  idle rather than the server reading Redis per request. The shared route handler
  is `createRefreshRoute` from **`@r10c/shells-next-common/server`** — anything a
  route handler or server layout _calls_ must ship from `/server`, so it is never
  reached through the client surface and stamped as a client reference.
- **A shell that two hosts mount is `scope:shared`.** `shells-next-marketplace-admin`
  is `scope:marketplace-admin` and holds the catalog's pages _and_ adapters, so no
  other app can reach them — that is the trap. `@r10c/shells-next-system-management`
  is `layer:shell` + **`scope:shared`** on purpose: back-office-app mounts it
  today and a bastion app mounts it later with zero moves. Do not "fix" the
  asymmetry by scoping it. Consequences: **`layer:shell` forbids same-layer edges**,
  so it cannot import `shells-next-common` and carries its own REST adapters
  (`config-service-domain`) and its own `/server` proxy factory; and the
  permission-annotated nav vocabulary (`GuardedNavItem`/`GuardedNavSection`) lives in
  `business-ts-authz`, the only layer both a shell and an app may depend on. Copy
  goes in the shared `shell:` namespace — `app:` keys are lint-restricted to `apps/`.
  A host keeps composition: route files, nav concat, the workspace `TabRegistry`, and
  the same-origin proxy mount (`/api/system`, **not** `/api/config`, which is already
  the config _fetch_ route). `rewriteServiceDomains` in `shells-next-common/server`
  is what keeps a real backend address out of the browser.
- **A server-owned but client-visible member must not be `@accessor({ readonly })`.**
  That flag drops the member from serialization **and** deserialization, so a
  read-only audit stamp would never reach the UI either. Leave it writable and have
  the route overwrite it from the verified principal — the same way a save route
  already owns the id (`entity.id = params.id`) — and hide the input with an
  `<EntityField … hidden />` slot.
- **One back office, two domain shells**
  ([ADR 0021](docs/adr/0021-consolidating-the-fleet-into-five-deployments.md))**.**
  `back-office-app` (`:3001`,
  `scope:back-office`) mounts `shells-next-marketplace-admin` **and**
  `shells-next-auth`, so sign-in, the account surface, user administration and the
  catalog share one origin — which is the whole benefit: the session is set on the
  host that serves everything behind it, and the `AUTH_APP_URL` hop, the
  cross-origin account links and the second Next process all disappear. The
  domains did **not** merge: each shell keeps its own `scope:`, they still cannot
  import each other, and only the host carries the composing tag. That is what
  makes the split reversible — a new app mounting `shells-next-auth` is the whole
  undo. Copy follows the code: an `app:` key is lint-restricted to `apps/`, so the
  shell's copy is `shell:auth.*`. Three route groups because they **gate**
  differently, not because they look different — `(authenticated)` (session only),
  `(back-office)` (also `authn:user-identity:read`), `(account)` (session only, on
  purpose: a plain `user` must reach their own account). All three compose one
  `BackOfficeChrome`. The three account destinations come from
  `ACCOUNT_DESTINATIONS` in `shells-next-common` and are `profile` /
  **`security`** / `sessions`; `security` replaced `password` and is a page of
  links into Zitadel, since there is no local credential to edit. `accountUrls`
  is gone with the cross-origin case it existed for.
- **Devices are labels, never authorization inputs.** `r10c_did` + `userAgent()`
  from `next/server` (no new dep; avoid `ua-parser-js` v2, it is AGPL). History is
  durable in Mongo so a familiar browser is not announced as new after its sessions
  expire. Admin session control is behind `authn:user-device:read|write`. Also
  [ADR 0004](docs/adr/0004-session-lifetime-devices-and-recovery.md), and also
  still standing — the rejected alternatives (JS fingerprinting, comparing the
  device at refresh) are worth reading before reopening this.
- **Recovery and lockout are Zitadel's** ([ADR 0016](docs/adr/0016-zitadel-authenticates-r10c-authorizes.md)
  supersedes those sections of ADR 0004). We have no reset token, no `forgot`
  endpoint and no attempt limiter, because there is no password here to reset or
  to guess. Mail lands in **Mailpit** (`:30826`), and the account page links out
  to the provider's self-service for password, MFA and linked accounts. What
  survives is `GET /api/dev/outbox` — it now carries only the notifications r10c
  still sends, which are about _sessions_: `NewDevice` and `SessionsRevoked`. It
  still 404s in production.
- **Authorization**: a permission is `<domain>:<entityKey>:<action>`, derived from the
  entity's own `@entity({domain,key})` (`permissionForEntity`); grants come from
  `ROLE_PERMISSIONS` in `@r10c/business-ts-authz`, never from the token, which still
  carries only `roles`. Guard a route with `requirePermission(...)` from
  `@r10c/shells-effect-service` (401 vs 403) — **hiding a nav item protects nothing**.
  `PolicyDecisionTag` is the ABAC seam; `canAssignRole` caps role creation at the
  actor's own tier. Creating a user always runs `registerUserUCFactory`, never a
  generic entity write. `unverifiedRoles` reads the cookie **without checking its
  signature** — nav filtering only, never a decision. Gated Next apps need a
  `seedSession` e2e fixture and a `readyPath` outside the matcher. See
  [ADR 0002](docs/adr/0002-authorization-roles-and-abac.md) and
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#authorization-role-aspects--permissions).
- **i18n is mandatory.** Ships `es` (default) + `en`. Copy goes through `useT`
  (`getServerT` on the server), typed against the catalogs in
  `@r10c/entifix-ts-i18n` — a bad key is a compile error, and
  `react/jsx-no-literals` fails the build on a string written into JSX. Locale is
  always a URL prefix, but **how a page reads it decides whether that app can be
  prerendered**: the back-offices rewrite and read `getRequestLocale()`, which
  calls `headers()` and so forces dynamic rendering, while marketplace-app has a
  real `app/[locale]` segment and binds copy with `getServerTFor(locale, ns)` —
  request-free, hence prerenderable. That binder lives in `@r10c/entifix-ts-i18n`
  (a `layer:shell` package may not import another, and the storefront shell needs
  it) and is re-exported from `shells-next-i18n/server`. **A new binder must be
  added to `BINDERS` in `tools/eslint/no-foreign-app-namespace.mjs` or it
  escapes the `app:`-namespace gate.** Every internal href carries the prefix:
  `LocaleLink`/`useLocaleHref()` in the back-offices (client, they read context),
  the server-side `StoreLink` in the storefront. Entity labels are
  `labelKey`/`enumLabelKey` metadata
  resolved in the browser (they never cross the wire). Services answer
  `{ error, code, detail }` and the client renders `code`. Runtime keys use the
  two documented escape hatches (`useTranslateKey`/`getServerTranslateKey`) —
  authored copy must not. Note lint is blind to copy inside JSX expressions like
  `{saving ? 'Saving…' : 'Save'}`. **A service answering with a `code` the
  `errors` catalog lacks fails the build** (`pnpm nx test @r10c/i18n-check`,
  unconditional in CI): parity cannot see it — a code missing from both locales
  is symmetric — and neither can types, because `useErrorMessage` renders through
  `useTranslateKey`, whose cast discards the augmentation. So the user reads
  `noActiveOrganization`. The scan knows the two emission shapes, the
  `{ error, code }` body literal and a `CodedAuthnError` subclass's second
  argument; it is forward-only, since `network`/`unexpected`/`configUnavailable`
  are synthesized in the browser. See
  [ADR 0003](docs/adr/0003-i18n-mandatory.md) and [docs/I18N.md](docs/I18N.md).
- **Observability**: a `-service` merges an observability layer that replaces Effect's
  default logger with the `@r10c/entifix-ts-tooling` logger and stands up the
  `@effect/opentelemetry` NodeSdk tracer, reading `logging.*`/`otel.endpoint` from
  config-service (`marketplace-admin-service/src/observability.ts` is the reference).
  See [ADR 0001](docs/adr/0001-observability-and-tooling.md) and [[observability-stack-decision]].
- **Frontend**: agnostic UI in `@r10c/entifix-react-controls` + tokens in
  `@r10c/entifix-style`; layout is flex-first (Every Layout, no media queries) with
  `Grid` the single CSS-Grid escape hatch. Page shells compose primitives and live in
  the Next shells. TanStack Query **wraps** Entifix (never replaces it), and TanStack
  Form backs `useEntityForm` behind a plain `values`/`errors`/`setField`/`submit`
  facade so `EntityForm` stays library-agnostic. Entity validation composes
  metadata → Standard Schema → caller callback; a schema is written against the
  **string draft** and its messages are **catalog keys**, never sentences.
  **marketplace-app inverts the default**: the storefront is public and
  read-heavy, so a React Server Component is the default and client code is the
  exception — home and product pages prerender per locale with ISR, `/cart`
  (`cookies()`) and `/search` (`searchParams`) are dynamic, and a route reading
  `searchParams` opts out the whole **route**, which is why `/c/[category]`
  cannot keep a static unfiltered copy without PPR. Two traps: import from
  `@r10c/entifix-react-controls/**primitives**`, because the main barrel is flat
  and pulled `EntityTable`/`FilterBuilder` **and the Effect runtime** (via the
  UI-preferences store) into the storefront bundle; and anything a server
  component calls ships from the shell's `/server` entry, so a module must not
  mix a pure helper with a `next/headers` reader. Cart state is a **cookie**, not
  localStorage, so the first response is correct — but `document.cookie` is
  percent-encoded (the server never sees this, `cookies()` decodes), the badge
  island reads it via `useSyncExternalStore` so the server snapshot may
  legitimately differ, and add-to-cart **redirects** because a Server Action
  leaves that island mounted and the count would otherwise never move. See
  [docs/FRONTEND.md](docs/FRONTEND.md), [[design-system-theme]], [[layout-primitives-decision]],
  [[workspace-tabs-design]].
- **A workspace library is compiled per-file, never bundled.** Every library under
  `packages/` builds with `@nx/js:swc` — there is no rollup or vite config left in
  `packages/`, and adding one back reopens three bugs at once. Bundling **merges
  modules**, so rollup silently drops each file's `"use client"` (only a bundle-wide
  `output.banner` survives, which is all-or-nothing and cannot describe a mixed
  client/server surface); it **absorbs CommonJS deps**, emitting an interop helper
  that reads `typeof require` and throws `dynamic usage of require is not supported`
  against a Next server runtime (Turbopack is not the culprit —
  `serverExternalPackages`/`transpilePackages` cannot fix a shim baked in before Next
  resolves anything); and it **writes the same `dist/` that `tsc --build` owns**,
  which is [#27](https://github.com/r10c-technologies/r10c/issues/27). Per-file swc
  has none of these: each module keeps its own directive, nothing is inlined, and
  `dist` has exactly two writers with disjoint file sets — swc emits `.js`/`.js.map`,
  `tsc` emits `.d.ts`/`.d.ts.map`/`.tsbuildinfo`.
- **`@nx/js:swc` runs `tsc` even with `skipTypeCheck: true`.** The executor's guard is
  `skipTypeCheck && !isTsSolutionSetup`, and this repo _is_ a TS solution setup, so the
  declaration pass always runs — with `ignoreDiagnostics: true`. Its errors are
  therefore **invisible**, while `noEmitOnError` (from `tsconfig.base.json`) still
  blocks the emit. A library whose `tsconfig.lib.json` overrides `lib` and drops what
  the base provides (`decorators`/`esnext.decorators`, needed by `Symbol.metadata` in
  `entifix-ts-core`) or omits `dom` produces a green build with **zero `.d.ts`** — and
  the poisoned `.tsbuildinfo` then makes the next `tsc --build` report a `TS6305`
  cascade. When overriding `lib`, extend the base list, never replace it. To see what
  the pass is hiding: `pnpm nx build <lib> --skipTypeCheck=false`.
