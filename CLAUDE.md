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
  ceiling; `catalog`, `stock` and `sales` are three tenant stores in **three**
  databases (`tenant_<id>`, `stock_<id>`, `sales_<id>`) so one-writer is a
  property of the handle; and
  the `marketplace` slice writes `published-catalog` by **consuming**
  `catalog.published`, not the slice that authored the offering — which is what
  keeps the public read host out of tenant storage. SID's `Product` is the
  instance a buyer owns, in `order-management`; the catalog record is
  `ProductSpecification`.
- **An in-store sale is a channel on the same order, not a different order.**
  TM Forum settles this and it is the non-obvious half: TMF622's `ProductOrder`
  carries a `RelatedChannel`, TMF676's `Payment` carries a channel, and SID names
  the concept in the Market/Sales **Sales Channel ABE** — nowhere does the
  standard fork the order by origin. So a vendor selling at their own counter
  produces the _same_ `ProductOrder`, and building a parallel in-store entity
  would split settlement, returns and the buyer's history permanently to avoid
  adding one member ([ADR 0024](docs/adr/0024-selling-through-a-vendors-own-channel.md)).
  The new domain is `sales-management`, **tenant plane**, one entity
  (`SalesChannel`) in its own `sales` store — the exact inverse of
  `catalog-reference`, which is platform plane _because_ a marketplace must merge
  brands and categories; channels never merge. Four consequences worth not
  re-deriving: the channel lands on `ProductOrder` as a **denormalized copy**
  (a platform-plane buyer cannot dereference a tenant pointer — the
  `PublishedOffering` precedent) but on `Payment` as a bare `channelId`, because
  a vendor and settlement both _can_ resolve it; `buyerId` is **optional**, since
  a walk-in has no account and forcing one breeds junk parties; commission is
  per channel type on `Agreement`, resolved through `commissionFor` — never
  `rates[type] || fallback`, which charges full commission for a 0% channel; and
  `settlement-management` **duplicates** the four channel-type literals because
  `business:domain` may not import another, so the two lists can drift and both
  are spec-pinned. No new tenant crossing: a counter sale calls the order slice's
  own `POST /api/product-order`, so ADR 0023 stays the single named path. The
  **till** — drawers, shifts, floats, variance — is deliberately absent: it has
  no ODA or SID name, so every field would be invented.

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
- **Four artifacts hold knowledge, one job each — do not merge them.**
  _How the business works_ lives in **Notion** (the `r10c` space, reached through
  the Notion MCP server); _what we decided and why_ is an
  **ADR**; _the contract_ is `BUSINESS-ARCHITECTURE.md` + `tools/slices/`; _what
  is next and whether it is done_ is a **GitHub issue under a milestone**. A
  process question goes to Notion, and the moment it forces a modelling call
  that call becomes an ADR in the same session — a settled Notion page does not
  update anything by itself. Business processes are **not** put in `docs/`: the
  corpus is `docs/*.md` flat files only, so a subdirectory gets zero checks,
  and lifting it to the top level hits the check that forbids naming anything
  the source does not declare — which is precisely what a process document
  exists to do. The inverse mistake is copying the domain map into Notion; it is
  already executable and a Notion copy has no test behind it. Milestones **M1–M6
  are slice promotions**, so each one's definition of done is a test
  `@r10c/slices` already runs. Projects v2 is declined: its `Status` field is a
  second truth beside the issue's own. And the repo is public now and private
  later, which does **not** run backwards — forks detach and stay public — so
  exposure is decided per commit, permanently: public law and our own mechanism
  are committable, our commission rates, named vendors and negotiated courier
  terms are Notion-only. See
  [ADR 0025](docs/adr/0025-where-planning-and-business-knowledge-live.md).
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
- **A use case is a class, and its descriptor is served — not imported.** Entifix
  generated UI from entities only, because `Actions = ['read','write','delete']`
  left `publish`/`approve`/`cancel` with no permission to name. A use case is now
  a `@useCase()`-decorated **class**: stage-3 decorators cannot decorate a
  standalone function, so the class is what makes annotation possible at all, and
  `save`/`delete`/`get`/`load` stay generic functions because they _are_ the CRUD
  triple. `Action` keeps its three values; a verb is a per-entity string that
  `permissionForUseCase(Ctor, key)` validates at **runtime** — compile-time
  narrowing does not survive `Symbol.metadata`, and `parsePermission` never had
  the typo check it looks like it has (it casts `segments[2] as Action`). The
  browser reads affordances from `GET /api/<entity>/$metadata` — a new
  `entityMetadata` envelope type, the same discriminant extension the
  transactions layer made — **authenticated and permission-filtered from the
  verified principal**, which is a security gain over nav filtering's `can()`
  against `unverifiedClaims` (an unsigned cookie), and which keeps the `Effect`
  body out of the client bundle. Per **entity**, not per service like real OData,
  because `EntifixEnvelopeMeta.entity` is the target's key and `entity: '*'`
  would be a wart; cost is N fetches on an N-entity screen. **Columns stay
  local** — `coerce-rsql.ts` needs them synchronously on the server — and that is
  the real line: a column is a property of the class, an action's _availability_
  is a property of the caller. Discovery is a **source scan**
  (`declaredUseCases()` beside `declaredEntityDomains()`), never `Symbol.metadata`,
  for `source-scan.ts`'s stated reason — metadata is reachable only through a
  barrel, so an unexported class passes every invariant vacuously; `@r10c/slices`
  therefore also asserts every `@useCase()` class is **reachable from its package
  barrel**, because a class nothing imports leaves the entity serving an empty
  action list, which is a `200` that reads as "no actions here". Three mechanics
  worth not rediscovering. The decorator writes **two** bags: the descriptor onto
  the _entity's_ metadata — via its **own** property, never the inherited
  `Symbol.metadata` lookup, which resolves along the prototype chain and would
  register the verb on a base class for every subclass to inherit — and the
  entity/verb pair onto the _use-case class's_. That second bag is what lets
  `permissionForUseCase(SomeUC)` take **one** argument, so the verb is written
  once, in the decorator, and every guard imports the derived const; the lone
  exception is `ROLE_PERMISSIONS`, which repeats the literal because
  `business:policy` may not import a domain package, and that is precisely why
  "every declared verb is granted somewhere" is a real check rather than a
  tidiness one. And a descriptor's `labelKey`/`keywordsKey`/`confirm.messageKey`
  are **runtime** catalog keys, so types cannot see a typo (the render path casts
  the augmentation away) and locale parity cannot either (a key missing from both
  locales is symmetric) — `@r10c/i18n-check` is the only thing that looks. Write
  the descriptor **inline**: `@useCase({ ...DESCRIPTOR })` compiles and makes the
  scan stop matching, which turns every invariant above into a vacuous pass.
  **The wildcard
  is unchanged, deliberately**: measured, only `super-admin: '*:*:*'` wildcards
  the action segment, every other grant wildcards entityKey, so a new verb
  escalates to nobody. The recorded residual is the tidy-up — collapsing three
  `catalog:*:read|write|delete` lines into `catalog:*:*` absorbs every future verb
  in a commit that touches only an entity file. **If any role but `super-admin`
  ever wildcards the action segment, reopen it.** Amends ADR 0003 ("no metadata
  endpoint had to be invented" is now false; keys still never resolve on the
  wire) and ADR 0014 (this is how a vendor-authored spec's descriptors reach the
  browser). See
  [ADR 0026](docs/adr/0026-the-use-case-descriptor-and-served-entity-metadata.md).
- **The `$metadata` route is per entity and its path is a literal — a parametric
  one is dead.** `HttpRouter` resolves through `find-my-way-ts`, where a static
  segment beats a parametric one and there is **no backtracking once the
  parametric branch matches**. So `/api/:entity/$metadata` registered beside an
  existing `/api/<entity>/:id` never runs: the by-id handler wins with
  `id === "$metadata"`, misses, and returns its own `404` — the endpoint reads as
  "this entity has no metadata" while appearing mounted, and no test that only
  checks the route is registered can see it. `shells-effect-service` exports
  `entityMetadataRoute(Ctor)`; each service mounts it per entity (four services,
  six entities today). It cannot be a `withHealthRoutes`-style wrapper, and
  duplicate `method + path` throws, so composition is opt-out, never override.
  The served document is **`{ actions, useCases }`** — the CRUD triple beside the
  declared verbs, both filtered through `PolicyDecisionTag` against the verified
  principal — which is why `ENTITY_ACTIONS` now lives in `entifix-ts-core` with
  `business-ts-authz` aliasing it: `entifix:react` reads the same triple and may
  not import the business layer. Three rules that are not obvious from the code:
  an entity the caller may not read answers **`404`**, identical to one the
  service does not host, because a `403` makes the endpoint an oracle for the
  model; the **ETag hashes the computed document**, never the descriptor set (the
  same hash for two principals `304`s one onto the other's affordances) and never
  `permissionsOf(roles)` (that bypasses `PolicyDecisionTag`); and `$metadata`
  skips `requireOrganization` even on a tenant-plane service, because it
  describes the model rather than tenant data and resolving a handle would leave
  a vendor with no active organization unable to see their own affordances.
  `EntityForm` renders from it, and **absent metadata keeps the old behaviour**,
  so an un-migrated call site is unaffected. The generic Next proxy
  (`createServiceProxyRoute`) now **carries the caching contract** — it forwards
  `If-None-Match` and passes `ETag`/`Cache-Control`/`Vary` back, answering a
  `304` body-less; it used to rebuild every response and strip all four, so
  `$metadata` could never revalidate. `Vary` is the half that is _correctness_:
  the document differs per caller, and one cached without
  `Vary: Cookie, Authorization` can be served to a different principal. The
  pass-through is a short allow-list, never a copy of every header — the
  upstream's `content-length` describes its own body, and carrying it onto a
  rebuilt response is how a proxy serves a truncated payload.
- **Placement decides the surface; binding decides the payload — and every one
  of the nine cells is decided** ([ADR 0035](docs/adr/0035-entity-actions-selection-and-bulk.md)).
  ADR 0026 said "one vocabulary, three surfaces" and built one, so `EntityForm`
  filtered `binding === 'entity' && placement !== 'context-dependent'` and
  **dropped four of the nine cells in silence** — the worst failure available
  here, because such a verb is declared, granted, exported and passes every
  `@r10c/slices` invariant, so its author reads the absence as a permission bug.
  `ui/actions/action-surfaces.ts` is now the one map: entity+context-independent
  → form header, entity+determining → form footer, entity+context-dependent →
  **row overflow menu**, collection+context-dependent → **bulk bar**,
  collection+context-independent → **table toolbar**, `unbound` → the palette
  (#129). **`collection` + `determining` throws**, because a determining action
  finalizes a _page_ and a list has none to finalize; it fires on the first
  render of **any** surface, not just the one that would have shown the verb —
  the `assertLinkSourcesAreEditable` reasoning. A spec asserts every cell is
  mapped-or-rejected, so a tenth cannot appear silently. Five things not to
  re-derive. **Two select-alls are two state shapes**: `EntitySelection` is a
  union of `ids` (what the browser holds) and `matching` (a filter the _server_
  evaluates, plus `excluded` and the `total` the confirmation must show) —
  written as one shape with a flag, the second quietly becomes the first and
  "the 25 rows I can see" runs over the store; the escalation is a **separate
  affordance carrying the count**, never a wider header checkbox. **The wire
  form is arrays** — a `Set` serializes to `{}` silently, so a selection sent
  raw arrives with its exclusions gone and acts on rows the operator removed;
  `readWireSelection` rejects a non-selection rather than defaulting, since
  defaulting to `ids` acts on nothing and to `matching` on everything.
  **`BulkOutcome` is per row**: forty selected and three failed is neither a
  success nor a failure, `code` resolves through the shared `errors` catalog, a
  retry re-runs **only** the failures, and the selection survives the action —
  a bulk run is deliberately **not one transaction**, since the rows share no
  invariant and atomicity would only turn a partial success into a total one.
  **Clone stays off the descriptor** (ADR 0026 closed it against per-verb
  payloads): it is `@accessor({ resetOnClone: true })`, and the id is cleared
  **without consulting the descriptors**, because `describeEntityColumns` drops
  `hidden` members and every generated form hides its id — a descriptor-driven
  sweep would leave it in place on exactly the forms a Clone button appears on
  and the "copy" would save over the original. And **`onSelect` and `selection`
  are mutually exclusive**, throwing: a picker chooses one value for a field
  holding one reference. `retire` on `ProductBrand`/`ProductCategory` is the
  first collection verb — retiring is _not_ deleting, because another slice's
  `ProductSpecification` holds a bare `brandId` nothing enforces — and it is
  granted to `super-admin` **as a literal beside `*:*:*`**, since a wildcard
  satisfying "every declared verb is granted somewhere" makes that check vacuous
  for precisely the verbs only the operator holds. The entityKey segment is
  wildcarded; the **action** segment is not, so ADR 0026's residual stands.
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
- **An entity can declare that it _owns_ a collection, and that is a different
  relation from a link** ([ADR 0034](docs/adr/0034-composition-metadata.md)).
  Two new `MetaAccessorType`s. **`composition`** is owned rows — an order's
  lines — which have no life outside the record and go out in the **same
  write**; `linkCollection` is association, where the target exists on its own
  and saves separately, and building master-detail on `EntityCollectionLink`
  would have inherited the per-row `EntityLinkResolver` fetch a composition
  never wants. **`scalarCollection`** is a bare `string[]`; it is a separate
  type rather than the same one because it has a **lossless string form**, so
  it round-trips through the string draft as a comma list while a row array has
  no string form at all. What this replaced was measured, not suspected: **five
  members declared `type: 'string'` while holding an array** — `ProductOrder.items`,
  whose own comment admitted it "falls outside the `MetaAccessorTypes`
  taxonomy", plus `DictionaryTerm.values`, `Role.permissions`,
  `Entitlement.domains` and `Membership.roleIds` — each with a hand-written
  `sortable: false, filterable: false`, which is five authors independently
  working around the same gap. One of those was live: `seedFieldValue` fell
  through to `String(raw)` (`'a,b'`, via `Array.prototype.toString`) and
  `coerceFieldValue` handed the same string straight back, so **saving a
  `Membership` without touching its roles replaced two ids with one
  comma-joined value** — and the seed/coerce fixed-point spec could not see it,
  because both halves were wrong in the same direction; only asserting the
  rebuilt member's _type_ catches that. Five things not to re-derive. **A child
  is described by its accessors, not by being an `Entity`**: `@accessor()`
  writes to its own class's `Symbol.metadata` with no help from `@entity()`, so
  `describeEntityColumns`/`extractMetaAccessors` now take a `ChildConstructor`
  and one walk describes an entity _and_ one of its rows — `OrderItem` is a
  value class with no id, no domain and no permission namespace, and
  `childType` is a **thunk** so decorator evaluation order stays irrelevant.
  **The serializer had to learn about it**, both ways: a child's state lives in
  private fields, so passing the array through untouched writes `[{}, {}]` and
  the lines silently never persist — a write that succeeds and stores nothing.
  A child's `alias` is still its storage column (`quantity` → `qty`), and
  serialization reads a plain object as happily as an instance, so a fixture
  produces the same document. **A collection declared `sortable`/`filterable`
  throws** rather than clamping, because the descriptor is also the server-side
  RSQL allowlist and an array compared as a scalar does not fail — it matches
  nothing, so clamping hides an empty result page behind a declaration that
  reads as honoured; the consequence is that `coerce-rsql.ts` needed **no**
  change, since a collection can never reach `coerceValue`. **`scalarCollection`
  round-trips now and `composition` does not**: the comma join and split are
  declared as inverses on both sides, empty reads as `[]` and never `undefined`
  (the same ordering trap `boolean` and `number` carry), while a composition is
  excluded from `reconstructEntity`'s scalar walk beside the two link types —
  writing it from a draft that never holds rows would blank a record's own lines
  on every unrelated save. And **the draft was not widened**; what did land is
  four structurally identical aliases (`EntityFormValues`, `EntityFormDraft`,
  `EntityLinkDraft`, `EntityCrudDraft`) collapsing into one `EntityDraft` in
  core, so #122 widens one type instead of finding four by search. Detail must be
  **same-store, same-slice** — one write is one transaction, and
  [planes](docs/_shared/planes.md) sends a cross-domain write through the saga —
  which `childType` cannot check, so it is a review rule. A tenth accessor type
  can no longer be added silently: core exports `COLLECTION_TYPES` beside
  `SCALAR_TYPES` and a spec asserts they partition `MetaAccessorTypes` with
  `id`/`link`, because every switch over that union has a `default` that treats
  the value as a string. Still not built: SQL persistence for embedded
  collections, and `linkCollection`'s editor (#26). The detail grid, row keys,
  nested error addressing and child validation are the next bullet.
- **A composition is edited in place, and the draft grew a second shape to hold
  it** ([ADR 0038](docs/adr/0038-master-detail-the-rows-a-record-owns.md)).
  `EntityDetailGrid` renders an owned collection as inline cells and
  `EntityForm` mounts it **itself** for any `composition` carrying a
  `childType` — so an entity that declares owned rows gets an editor with no
  per-entity component, which is what makes it reachable through
  `makeEntityCrud`. Placement is a **partition, not an ordering hint**: every
  grid renders below every field whatever `order` it declared, because a grid
  between two labelled inputs reads as a field and it is a second record list.
  Six things not to re-derive. **`EntityDraft` is
  `Record<string, string | EntityRowDraft[]>`, deliberately not `JsonValue`** —
  that would permit shapes with no editor and no coercion, and it is _recursive_,
  which makes TanStack Form's field-path derivation unbounded (`Type
instantiation is excessively deep`); every scalar read is now
  `readDraftString`. Flattening rows into `items[0].quantity` draft keys was the
  tempting alternative and is **impossible**: `restoreEntityDraft` lets the
  **seed** decide the keys, a row count is not derivable from the entity, so
  every row entry would be dropped on restore and autosave would lose the lines
  it exists to protect. **A seeded row key is positional (`row-0`) and a
  user-added one is a UUID**, and that asymmetry is a measured hang, not taste:
  `useEntityForm` re-seeds whenever `entity` changes identity — every render for
  a caller that builds the record inline — so a random key there makes the draft
  differ on every pass and React stops with `Maximum update depth exceeded`.
  **Rows are keyed by `$key` and errors by index** (`items[2].quantity`), two
  identities for two jobs: a Standard Schema issue carries only a positional
  path, so the metadata rules and the schema rules would otherwise address one
  cell two ways and `composeEntityFormErrors` could not merge them; the stale
  index is harmless only because `revalidateLogic` re-runs the whole validator on
  every edit. **`required` means two things one level apart** — per row on a
  child member, `rows.length > 0` on the collection member. **The write is a
  second pass**: `isWritableScalar` goes on refusing `composition` so a coerced
  string can never reach it, and an _unreadable_ draft entry is **skipped, not
  cleared**, since blanking a record's lines on a save that touched one scalar is
  invisible data loss. And **`Enter` appends a row only because `EntityForm` is a
  `<Card>`, not a `<form>`** — wrapping it in a real form for accessibility would
  hand the key back to the browser and break the grid. It is bound to the _row_,
  not its last cell, because the last column may be `readonly` and a disabled
  input never receives a key. Not built: reorder (no metadata distinguishes a
  child whose order means something), derived totals (a `footer` slot — summing
  minor units across currencies is wrong), and nested composition.
- **A picker also edits a bare foreign key, and that is the normal case now.** When
  the target lives in another slice's store a typed `EntityLink` is an illegal import
  _and_ a cross-store join, so the member is a plain `string`
  (`ProductSpecification.brandId`/`.categoryId` into `catalog-reference`). Nothing in
  the editor changes: `EntityLinkInput` writes `String(target.id)` into the draft for
  either shape, and `applyEntityLinks` skips a non-`link` descriptor, so the id stays
  the truth and the form wrapper reconstructs from the draft string. The whole type
  test is `PICKABLE_TYPES` (`link`, `string`) in `EntityForm`; a source aimed at
  anything else **throws**, because a dropped source renders identically to a
  read-only field — the same fault `assertLinkSourcesAreEditable` already caught for
  `linkCollection`. Two traps: `linkLabelProperty`/`linkSearchProperty` come from the
  _owner's_ accessor and default to `'name'`, but a scalar id's `@accessor()` cannot
  name the target's members (it may not import it), so the entity-tight wrapper
  states them at the `useEntityLinkSource` call rather than leaning on the default;
  and the target's search member must stay `filterable` — that flag is the
  server-side allowlist, and losing it is silent at both ends (`400`, rendered as an
  empty suggestion list). Resolving an id goes through the owning domain's own read
  path — a second adapter in the same shell, never a join.
- **A form's submit rebuild is derived, not written.** Core's
  `reconstructEntity(Ctor, values, options?)` — where `options` carries
  `existing` and `selection` — replaces the one hand-written
  function every entity form used to carry: it walks `describeEntityColumns`,
  coerces each draft string, and hands the relations to `applyEntityLinks`. Four
  things not to re-derive. Construction is **zero-argument** (`new Ctor()` then
  setters, the shape `buildEntityInstance` already uses): entities default their
  ctor parameters and a required member is filled by its setter a moment later,
  so required-ness stays the `@accessor({ required })` flag rather than a second
  list of argument names nothing verifies — and constructing first is what gives
  `describeEntityColumns` a sample, so an undeclared relation is still recognized
  as one. `existing` supplies the **id and nothing else**, which is the
  create/update distinction that used to be a `target.id = entity?.id` line per
  form. The coercion is the exact **inverse of `seedFieldValue`**, and the two
  live in different packages (core is below `entifix:react` and cannot import the
  other half), so a fixed-point spec in `entifix-react-integration` is the only
  thing that can see them disagree — which matters because both disagreements are
  silent and survive validation: `boolean` is decided **before** the empty check
  (`raw === 'true'`; a cleared checkbox drafts as `''` and means `false`, not
  absent) and `number` checks empty **first** (`Number('')` is `0`, so the other
  order turns every blank numeric field into a real zero). And assignment is by
  `descriptor.name`, never `.key` — `key` is `alias ?? name`, the wire/SQL column.
  Read-only members are skipped here even though `describeEntityColumns` keeps
  them, because a form shows one and cannot write it. Closes #126; #127
  `makeEntityCrud` stands on it.
- **Four screen types, and the sidebar's top tier is the type, not the domain**
  ([ADR 0033](docs/adr/0033-the-screen-taxonomy.md)). **Definiciones** (`master`
  — you authored the record, no lifecycle, CRUD), **Operaciones** (`operation` —
  a process made it, it has state, the verbs are domain verbs), **Asistentes**
  (`wizard` — guided, multi-step, ends), **Consultas** (`report` — aggregate,
  nothing to edit). `makeEntityCrud` is the generator for `master` **and only**
  `master`, so a screen that is not Definiciones is not a gap in it — Fiori
  reached the same split, every floorplan generated except the wizard and the
  initial page. The rule that keeps the four from dissolving: **"publish" is an
  action on a `master` screen, not a fifth type** — ADR 0026 gave every entity a
  way to declare verbs, so a verb as grounds for promotion promotes all of them;
  and a **worklist** is an `operation` with a default filter bound to the
  principal, never a type, because a type would put one record class in two nav
  places. Four things not to re-derive. The **identifiers are English and the
  copy is Spanish, and three of the four differ** — `query` collides three ways
  here (RSQL, TanStack Query, `filterable`) and `assistant` reads as an AI agent
  — so `SCREEN_TYPE_LABEL_KEYS` sits next to the enum in `business-ts-authz`,
  `shell:`-namespaced copy in a `business:policy` package on purpose, because a
  second declaration site is the drift `nav.ts` was already merged once to stop.
  **`Definiciones`, not `Maestros`**: the ERP word needs the ERP background to
  parse, and `Catálogos`/`Referencias` are both out on live collisions — the
  product catalog, and `storefront.category.sortByCode` already rendering
  "Referencia" for a product's code. **`type` is optional and exactly one
  section may skip it** (the account surface, which is not administrative and
  carries no permission for the same reason); a second untyped section means the
  taxonomy is missing a case. And **every contributing shell declares its own**,
  because `GuardedNavSection` is the only layer a `layer:shell` package and a
  `layer:app` both reach — this is never an edit in the host, and `visibleNav`
  must propagate `type` or the tier is unbuildable downstream while every test
  still passes. Not built yet: the nested rendering (#113, #123), and `TabKind`'s
  `catalog:`/`entity:`/`system:` prefixes becoming type-derived when #141 makes
  the registry derive from the nav — renaming them by hand now is work done
  twice, and a rename abandons whatever tabs a workspace was holding.
- **A catalog's pages are generated, and the implementation layer is empty
  because of it.** `makeEntityCrud(Ctor, opts)` in **`shells-next-common`** builds
  the list page and the single-record page for one entity and returns a named
  descriptor (`entityConstructor`/`entityKey`/`basePath`/`ListPage`/
  `SingleViewPage`), so #141 can derive a nav entry and a `TabKind` from the same
  object instead of the two const maps and the literal ternary it replaces. It
  **cannot** live beside the hooks: it needs `EntityTable`/`EntityForm` from
  `entifix-react-controls` and `useDataLoading`/`useEntityForm`/`useEntityRecord`/
  `useEntityMutation`/`useEntityLinkSource` from `entifix-react-integration`, and
  `entifix:react` is absent from its own allow-list — the shell layer is the
  lowest place that reaches both, and it already owns `useLocaleHref` and the
  `TabRegistry`. Six options are what metadata cannot know (`basePath`,
  `catalogKey`, the record's repository adapter, the configuration adapter,
  `hiddenFields`, `links`); everything else is `describeEntityColumns`. Four
  things not to re-derive. The title key is a **derived union**
  (`EntityCatalogKey` maps the `entity` catalog down to the keys carrying both
  `form.editTitle` and `form.newTitle`), which keeps `useT` checking it with no
  `useTranslateKey` — the escape hatch authored copy must not use, and the only
  thing that _could_ check it, since `@r10c/i18n-check` scans
  `packages/business/ts` for `@useCase()` decorators and never `.tsx`; the
  factory also asserts the key **is** the entity's `@entity({ key })`, because a
  drifted one titles the form after another entity. `links` is **frozen at
  factory time**, which is what makes the source loop legal at all —
  `use-entity-link-sources.ts` carries the repo's single
  `react-hooks/rules-of-hooks` disable, because the array is the same object
  every render and the rule reasons syntactically about the loop instead. A
  member in `hiddenFields` is dropped from the rendered fields, **not** from the
  draft, so `ProductBrand.code` survives an update that never showed it. And
  `use-entity-link-sources.ts` needs its own `'use client'`: the crud barrel is
  re-exported from `shells-next-common`'s flat client entry, so without it a
  Server Component importing anything from that package drags `useEffect` in and
  the Next build fails — per-file swc keeps each file's directive, and a module
  with hooks and no directive is the hole. `packages/implementation/*` is now
  **empty**: every organism it held was a pass-through whose only non-generic
  token was a class name. The layer stays declared and tagged for the first
  component that genuinely cannot be derived. Closes #127 and #140.
- **An autosaved draft is JSON round-trippable, period — and it belongs to one
  principal** ([ADR 0032](docs/adr/0032-what-may-live-in-an-autosaved-draft.md)).
  Four decisions, each enforced somewhere rather than written down and hoped for.
  **JSON**: a draft goes through `createJSONStorage`, so a class instance, an
  `EntityLink` or a `Date` does not degrade — it returns as something else,
  silently. `JsonValue` in core types `DraftsState.drafts` and
  `useDraft<TDraft extends JsonValue>`; `mergeDrafts` runs `isJsonValue` **per
  entry** at restore, so one bad draft does not take the workspace's others with
  it. Declare a draft type as a `type`, never an `interface` — TS gives an
  interface no implicit index signature, and the resulting "Index signature for
  type 'string' is missing" explains nothing. `UiPreferencesState` is
  deliberately exempt: it writes through **structured clone** and does keep a
  `Date`. **Relations**: ids live in the draft, instances beside it, and the
  sidecar is _not_ persisted — it is refilled from the id via
  `EntityLinkSource.selected.entity` (the lookup already fetched the whole target;
  only its label was being used) handed to `useEntityForm`'s **`hydrateLink`**,
  which writes the sidecar without touching the draft or the dirty flag, because a
  lookup landing is not a pick. `applyEntityLinks` now **throws** on an
  `embedded` member holding an id with no instance instead of quietly writing the
  `id` shape — which is what made two saves of one unchanged form differ across a
  refresh — and `EntityForm` disables Save while any source resolves so that
  throw stays unreachable. Latent today: nothing in `packages/business` declares
  `type: 'link'` at all. The seam itself is a **port**, not per-page plumbing:
  `UseEntityFormOptions.draft` takes an `EntityDraftStore`
  (`draft`/`save`/`clear`) and `useEntityForm` writes to it from an effect
  whenever the values differ from their seed, with `useEntityDraft(address)` in
  `shells-next-common` as the workspace's implementation. A port because
  `useDraft` is `layer:shell` and the hook is `layer:entifix`, so it cannot
  import the store — and it lives beside the options rather than in core,
  unlike `EntityLinkSource`, which had to sit below two `entifix:react`
  packages that may not import each other. Handing a store to a form is the
  **whole** opt-in, so a route stays ephemeral by omission rather than by a
  flag, and the hook never calls `clear`: a draft is spent when the write
  _commits_, which only the page owning the mutation knows — it clears on a
  successful save or delete and deliberately keeps the draft on a failed one.
  What this replaced was two of three editors having no draft at all
  (`ProductEditorTab` hand-wired `useDraft`, `CatalogEditorTab` wired nothing),
  so brand and category tabs lost an edit on refresh, never showed the dirty
  marker, and closed with no confirmation. **Versioning**: `DRAFTS_VERSION`/`TABS_VERSION` with an
  explicit `migrate` to empty (zustand discards anyway, but logs an error for a
  deliberate decision); it covers the _envelope_ only, and member drift is
  `restoreEntityDraft` layering a restored draft **over** a freshly seeded one —
  the entity decides the keys, the draft decides the values, so a member added
  since no longer arrives `undefined` and flips its input uncontrolled.
  **Scope**: the key is `drafts:<userId>:<activeOrganizationId>`, resolved
  server-side (the cookies are httpOnly) and applied with `persist.setOptions`
  **before** rehydrating — set it after and the unscoped set is restored first.
  `WorkspaceShell`'s `scope` prop is required on purpose. Unverified claims are
  fine here for `navRoles`' reason, and ⚠️ **IndexedDB is not a confidentiality
  boundary** — whoever can read that object store already holds the session
  cookie, so this stops an accidental cross-account restore and nothing more.
  Recorded residual: no clearing on sign-out, because there is no client sign-out
  handler to hook.
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
- **The client mints the transaction id, and the engine never publishes**
  ([ADR 0028](docs/adr/0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md)).
  A transactional `POST` carries a **`command` envelope** with a client-generated
  UUID — not an entity envelope the service converts — because the id is also the
  stored entity's id (`entity.id = command.transactionId` was already true) and
  therefore the **idempotency key**: a repeat is a retry, answered `202` with the
  same status link and executed once, never a `409`. No server-side fallback mints
  one; a missing or non-UUID id is `400`, and the key space is narrow because
  untrusted input is becoming a primary key. This is also what fixed a create that
  **reported an error in the browser while succeeding on the server** — the save
  adapter parsed the `202`'s `transactionEvent` envelope with `readEntityEnvelope`,
  and `fetch-client` treats `202` as `ok`, so it surfaced as an `EntifixBuildError`
  that no test could see. Opt an entity in with `create: 'command'` in
  `BuildEntityRestOptions`; plain REST creates are unchanged.
  Every event now goes to a **`TransactionOutbox`** and a relay carries it to
  RabbitMQ — `execute` used to commit Mongo and then `bus.publish` separately, so a
  broker outage between them left a successful write mislabelled `STALE`.
  `accepted`/`failed` are written by the engine; **`completed` is written by the
  handler, inside the entity's own Mongo transaction**, because only the handler
  holds a session and a session may not enter the framework-free
  `EntityRepository`/`TransactionOutbox` ports — so the engine's success path
  records nothing, and a spec asserts it. The outbox lives in the **tenant**
  database beside the entity (single-database ⇒ single-shard; and an outbox holds
  event payloads, so a control-plane one would drag a whole offering out of the
  tenant plane once `catalog.published` uses it). Delivery is **at-least-once**:
  a consumer that must not fold twice dedupes on `event.id`, never
  `transactionId` — one transaction emits three messages, so the correlation id
  would make `completed` look like a redelivery of `accepted`. Two relay speeds — the committing
  request drains its own handle inline, a daemon sweeps `tenant_*` for what it
  missed. This does **not** weaken ADR 0022's "never one transaction": the
  transaction is one domain, one slice, one database.
- **Every bus message is an `event` envelope, and the exchange routes**
  ([ADR 0029](docs/adr/0029-the-event-envelope-and-a-routed-bus.md)). The
  `{ meta, data }` split was already right; what `meta` lacked were the facts a
  _bus_ message needs, so it gained an optional `event` block (`name`, `id`,
  `source`, `at`, `correlationId`) and `meta.entity` became **optional** — it was
  a required string meaning the target class on HTTP and the subject on the bus,
  it has no honest value for `settlement.run.completed`, and grepping shows
  **nothing ever read it** (only `meta.type` is, twice, in `read-envelope.ts`),
  which is how it drifted into two meanings unnoticed. The rule that settles
  every future field: **`meta` describes the message, `data` describes the
  occurrence** — so `correlationId` is metadata and an outcome's `code` is not.
  Four things not to re-derive. `EventBus` is typed on `DomainEvent`, not
  `TransactionEvent`, because a bus that knew one publisher's payload left
  ADR 0009's `catalog.published` needing a second framing and #136's
  `EntityChangeEvent` a third. **`source` is the emitting slice** — not the
  deployment (co-deployment moves it, ADR 0021) and not the domain (a slice holds
  several) — provided as `EventSourceTag` at each composition root so a service
  that forgets it fails to build its layer instead of publishing events signed by
  nobody; and it is for routing, observability and audit, **never a consumer
  branch**, which is the one transferable half of .NET's `(sender, eventArgs)`,
  whose `sender` is bare `object` precisely to make depending on it awkward.
  **One dedup key, `event.id` = `<transactionId>:<step>`** — exactly what the
  outbox's unique index enforces, so the idempotency claim and the dedup key are
  one value rather than two that drift; `TransactionEvent` keeps its own
  `transactionId`/`at` as payload members anyway, the way CloudEvents duplicates
  `subject`, because a payload must stand alone once unwrapped. And the exchange
  is **`entifix.events`, type topic**, routing key = `event.name`, with
  `subscribe(pattern, handler)` binding the string `tools/slices/` already
  declared as `subscribedEvents` — fanout meant every subscriber received every
  publisher's traffic and filtered in its own handler, which is the fault #136
  warns about for sockets, already live. A broker will not retype an exchange, so
  the old `entifix.transactions` fanout is abandoned rather than migrated and a
  `dev:reset` clears it. `@r10c/slices` asserts a publisher exists for every
  subscribed name (planned slices count — ADR 0022 records ownership before a
  process); asserting _emission_ would red-build until #145, so that check ships
  with the commit that makes it true. Amends ADR 0028: every one of its decisions
  stands, only the dedup key and `OutboxEntry`'s shape move.
- **The bus has a failure vocabulary now: delivered, retrying, quarantined —
  read [ADR 0030](docs/adr/0030-failure-retry-and-quarantine-on-the-bus.md)
  before touching either side of it.** What it replaced, measured rather than
  suspected: `nack(message, false, false)` ran against a queue with **no
  dead-letter exchange anywhere in the repo**, so a failed handler and a
  malformed payload both dropped the message with nothing to replay from — the
  code comment and the spec name both said "dead-letter", which is how it
  survived review — and `assertQueue('', { exclusive: true })` died with its
  connection, so anything published while a subscriber restarted was dropped by
  the broker **although the outbox had already marked it sent**. Three failure
  classes, and they must not be conflated: **transient** (the handler threw —
  `nack(…, requeue: true)`, and the broker counts the redelivery against
  `x-delivery-limit`), **poison** (`readEventEnvelope` rejects the payload, or it
  is not even JSON — `nack(…, requeue: false)`, straight to quarantine with
  **zero** retries, because a payload that cannot be deserialized never becomes
  deserializable and retrying it only spends the budget of the messages behind
  it), and a **business failure**, which is _not the bus's concern at all_ since
  that message was processed successfully and already produced a `failed` event.
  A subscription is `{ slice, pattern, mode, maxAttempts }`. **`work`** binds a
  named durable quorum queue that replicas share and that accumulates while the
  consumer is gone; **`broadcast`** keeps the exclusive queue 0029 built, for
  #136's socket push where every replica must receive — 0029 did not pick the
  wrong queue, it picked broadcast semantics for a workload that is work.
  Failures dead-letter to one **`entifix.events.dlx` direct** exchange with a
  `<queue>.quarantine` per queue, never one shared, because replaying a mixed
  quarantine redelivers another subscriber's messages. Five things not to
  re-derive. **`slice` is the _subscribing_ slice, never `EventSourceTag`**,
  which names the emitter: one deployment hosts several slices (the tracker is
  `transaction`, co-deployed into marketplace-admin-service), so deriving the
  queue name from the publisher files a consumer's queue under whoever shares
  its process, and splitting the slice back out to `:3103` would then rename a
  durable queue and abandon whatever was still in it. **`x-delivery-limit` is
  immutable once the queue exists** — re-declaring with a different
  `maxAttempts` fails `PRECONDITION_FAILED` and closes the channel, with no safe
  automatic recovery — so a subscription's ceiling is a **literal beside its
  register declaration**, not config-service: a tunable nothing can adopt is
  worse than a constant. The relay's ceiling _is_ config (`outbox.maxAttempts`),
  because it is re-read every sweep and nothing in the broker pins it; it is
  also the repo's first `getNumber` caller, deliberately, since `'five'` cast to
  a number makes every comparison false and quarantines nothing, silently. The
  **quarantine queue is declared before the queue that dead-letters into it**, a
  `direct` exchange dropping what it cannot route. And **`JSON.parse` belongs
  inside the Effect**: outside it, a non-JSON body threw synchronously into
  amqplib's callback and the message was never even nacked — a third poison
  class with no path at all. On the publisher side `OutboxEntry` gained
  `attempts`/`lastError`/`quarantined`: past the ceiling an entry is quarantined
  and **skipped**, so the head of the line moves, where before one unpublishable
  entry blocked that tenant's outbox forever and invisibly. It logs rather than
  counts — the count is #186's and needs a meter provider — and the sweep's
  `catchAll` logs too, which is what makes the `IndexOptionsConflict` below
  visible instead of silent. `pending` now filters `quarantined: false` and so
  does the partial index, which is why this change needs a **`dev:reset`**: the
  queues are new names and auto-delete, but Mongo rejects re-declaring
  `{ createdAt: 1 }` with different options. Delayed redelivery is deliberately
  **not** built, and the 3.13 broker already has quorum queues, so none of this
  waited on the 4.x bump (#181). Still open, and the reason the register carries
  **no `dedupe` field yet**: #178's `TransactionInbox` claiming `event.id` in the
  same storage transaction as the side effect — until it exists every consumer
  must be naturally idempotent, and both of today's are — and #180's graceful
  shutdown, because an unacked message at SIGTERM is the same redelivery
  question.
- **The reactive stream is server-sent, same-origin, and scoped per connection**
  ([ADR 0036](docs/adr/0036-the-reactive-stream-is-server-sent-and-same-origin.md)).
  `ReactiveChannel` was always the right port; what it lacked was a transport,
  and the issue's premise — a WebSocket — was wrong for this repo. Every browser
  address is rewritten to a same-origin proxy path (`rewriteServiceDomains`)
  because `r10c_at` is `httpOnly` + `sameSite: 'lax'`, and the `WebSocket`
  constructor accepts **no headers**, so a socket would need a second class of
  bearer token handed to client JavaScript — the exact thing `httpOnly` prevents.
  SSE keeps the cookie path unchanged and throws in the half #137 would otherwise
  hand-write: `EventSource` reconnects with backoff and re-sends `Last-Event-ID`.
  The plumbing for the rejected option is all present (`HttpServerRequest.upgrade`,
  `ws` transitively, an upgrade handler already routing through the same
  `HttpRouter`) — the cost was never the transport, it was the token. Six things
  not to re-derive. The route is **`GET /api/transaction/events`, owned by the
  `transaction` slice**, because `slices.spec.ts` asserts no slice subscribes to
  its own events and `marketplace-admin` publishes `transaction.*` — and because
  it is `GET /api/transaction/:id` upgraded from poll to push, same facts, same
  caller. It is the first **`mode: 'broadcast'`** in the register, which is the
  consumer ADR 0030 named by number when it built the mode: every replica holds
  different connections, so `work` would deliver to one replica and the clients on
  the others would silently never learn. The frame is an **`EventEnvelope`**, not
  a fourth framing — the `transactionId`, timestamp and sequence #136 asked to add
  already exist one level up as `meta.event.correlationId` / `.at` / `.id`, so
  `EntityChangeListener` widens to `(event: DomainEvent<EntityChangeEvent>) => void`
  and nothing is duplicated onto the payload. ⚠️ **`TransactionEvent` gains
  `organizationId`** (in `data`, not `meta` — 0029's rule is that data describes
  the occurrence) because it carried none, so per-connection scoping was not
  expressible at all; the filter is server-side per connection and **fails
  closed**, since defaulting the other way makes every pre-existing event a
  cross-tenant delivery. ⚠️ The connection is **bounded by the token's `exp`**,
  not held open: a revoked session stops within 15 min, which is exactly the bound
  `requirePrincipal` already gives every REST call — an immediate close needs an
  `auth`-published revocation event and a session→connection index, and is #53's.
  And the server **does not replay**: `Last-Event-ID` is accepted and ignored,
  because answering it from the outbox makes it a per-connection backlog with a
  retention policy and a second durability contract beside ADR 0028's. Four
  mechanics from the build, none of them guessable from the record.
  `createServiceProxyRoute` used to **buffer the upstream body**, which against
  `text/event-stream` holds the request open forever and delivers nothing with no
  error and no timeout; it now has a pass-through arm keyed on the content type,
  and the catch-all route is `dynamic = 'force-dynamic'`. The stream **opens with
  a `: open` comment**: a chunked response writes its headers with its first
  chunk, so a stream that stays silent until something happens — which is most of
  the time, by design — leaves the client in `CONNECTING` indefinitely; measured,
  `fetch` against the route did not resolve at all without it. `readCommandEnvelope`
  **drops an `organizationId` the caller sent** and the route stamps the verified
  one, the `entity.id = params.id` rule again, because the member decides which
  browsers a write reaches. And a caller with **no** organization gets an empty
  stream rather than a `409` — the connection is legitimate, there is simply
  nothing tenant-scoped to send, and failing would leave a vendor who has not
  picked an organization unable to load the workspace at all. `GET /api/transaction`
  — unauthenticated, unscoped, `store.list()` over every organization — was
  **deleted rather than filtered** (#194): nothing called it, and a readable index
  of what every vendor is creating and what is failing is a surface worth removing.
  `GET /api/transaction/:id` is guarded and answers **`404`** for another tenant's
  record, since a distinguishable status makes it an oracle for ids that are also
  primary keys. Amends ADR 0028 (the payload member; every other decision there
  stands).
- **A service describes its own wiring, and the point is the diff**
  ([ADR 0031](docs/adr/0031-a-service-describes-its-own-wiring.md)).
  `GET /api/$service` — slices hosted, stores opened, events published,
  subscriptions bound, upstreams called — generated from the **health probe
  registry**, so readiness and the description come from one registration and
  there is no second list to drift. It is a sibling of `/api/config`, not part
  of it: config is _inputs_ (values, redacted), this is _shape_ (wiring); and it
  is **not** `$metadata`, whose per-entity choice is about entity affordances and
  stands. Six things worth not re-deriving. **`HealthProbe.targets` is a list**,
  not the single string the issue sketched: marketplace-admin-service's one Mongo
  client backs `catalog` **and** the co-deployed `transaction` slice's `saga`,
  and the alternative — one probe per store — would put both names in
  `/api/health/ready`'s `failing` array, changing an unauthenticated wire format
  to serve a gated document. The composition root supplies those names
  (`MongoHealthProbeLayer(['catalog', 'saga'])`), which is the one place the
  "gains a datastore, gains a line, with no edit" promise is qualified — a client
  package knows it has a connection, never a Store's _register_ name.
  **Subscriptions and publishes go into a second registry**, `WiringRegistryTag`
  beside `HealthRegistryTag`, because a bound queue is not a readiness fact and
  folding them would put unprobeable entries in the readiness response; the AMQP
  adapter records a publish **after** it succeeds (recording the intent would let
  the diff pass for a service whose every publish fails) and both recorders
  deduplicate, since a reconnect re-runs every consumer's setup and a publisher
  emits the same name forever. **`ServiceDefinition.slices` cannot be derived** —
  `EventSourceTag` is the _emitting_ slice and one deployment hosts several — so
  it is stated in `main.ts` and checked against the register's `deployments`.
  **The diff fails in one direction only**: observed-but-undeclared fails,
  declared-but-never-observed is an advisory, because a fleet that has just
  booted has emitted nothing and a check that is red by default is one people
  learn to ignore; on today's fleet the advisories are precisely the three drifts
  the record was written about (`catalog.published` declared and never emitted,
  `marketplace`'s subscription to it never bound, `published-catalog` never
  opened). **`tools/slices/src/fleet.ts` holds the address per deployment** —
  no `SliceDeclaration` carries one — and `slices.spec.ts` checks it both ways,
  since a promoted slice missing from it leaves `dev-infra:map` passing by asking
  nobody anything. And it is **service-token gated** with **logical names only**,
  never a URI and emphatically never `tenant_<organizationId>`, which would make
  it an organization enumerator. Metrics stay out: per-replica and un-alertable,
  they belong in OTLP (#185/#186), which is ADR 0001's still-unbuilt half —
  `observability.ts` has an `OTLPTraceExporter` and no `MeterProvider`, so a
  `Metric.*` call today goes nowhere.
- **A flow that spans slices is orchestrated; a single-step write stays
  choreography** ([ADR 0039](docs/adr/0039-multi-step-sagas-are-orchestrated.md)).
  The engine runs **one** step in **one** service — `TransactionCommand.type` is
  the literal `'create'`, `executeUCFactory()` is a single call — and that is
  correct for what it does. Checkout is four steps over three slices and three
  databases that [planes](docs/_shared/planes.md) forbids from transacting
  together, so it is a different engine, not a bigger handler. Multi-step flows
  are **orchestrated, per flow, opt-in**: single-step writes are not rewritten
  and do not pay coordinator cost. Six things not to re-derive. **The step
  definition is data, not a class, and the boundary rule is why** — an
  orchestrator knowing checkout's steps must reference three domains, and a
  `business:domain` package may not import another, so a `SagaDefinition` walked
  by a generic engine is the only legal shape; the constraint is the design, the
  same move `makeEntityCrud` made against the empty implementation layer. Steps
  are **`compensatable` / `pivot` / `retriable`** (Richardson), and the engine
  **throws at definition load** on two pivots, a pre-pivot step with no
  compensation, or a post-pivot step that declares one — the last because it
  could never run, so it is false assurance rather than dead code; load-time, not
  step-time, for ADR 0035's reason. **Commands go out over HTTP on ADR 0023's
  path and results come back over the bus**, and the asymmetry is the point: HTTP
  gives a synchronous `400` before there is state to unwind, the bus gives
  durable at-least-once completion. A command exchange was rejected — there is no
  principal on an AMQP frame, so it needs an authentication scheme invented
  beside the fleet's own, and `tools/slices/` has no command vocabulary, without
  which ADR 0031's `/api/$service` diff goes quietly blind. **Dispatch goes
  through the outbox**, extending ADR 0028's persist-before-publish rule to
  commands; a relay that POSTs rather than publishes is the one genuinely new
  mechanism. **Compensation is a semantic reversal with its own events** — a
  refund is not an uncharge — and a _failed_ compensation is the state nobody
  plans for: it leaves a reservation held and a customer charged, so it is
  surfaced, never swallowed. Coordination state stays in the existing **`saga`
  store** and the `transaction` slice keeps `domains: []`, because orchestration
  is a mechanism and a domain name would enter the permission namespace and the
  entitlement key for something no organization is provisioned for; splitting to
  `:3103` waits for a participant outside marketplace-admin-service.
  **Durable execution (Temporal/Restate) is rejected with a stated reopen
  condition** — its own tripwire ("building state tables, custom retry logic and
  DLQ consumers means you are already writing a workflow engine") does describe
  us; it is declined for a second programming model beside Effect, a rung the
  health ladder must learn, and because it displaces ADR 0028's outbox rather
  than extending it. **If the definition grammar grows conditionals, timers or
  human tasks, stop and adopt one.** The multi-step engine is **not built**; what
  is in effect is the vocabulary, the constraints, and three corrections that
  shipped with the record — `TransactionStore.list()` deleted (no callers since
  #194 removed the unauthenticated cross-tenant index it served), the single-step
  rollback failure now **logged** instead of vanishing into `Effect.ignore` (the
  ignore itself is right — the client must still get a terminal state — but the
  recorded `error` is `execute`'s, so the compensation's own error reached
  nothing), and `rollback`'s `outcome` documented as always `undefined` and
  structurally unreachable until that engine exists. Amends ADR 0028; applies
  ADR 0023 and ADR 0029 without changing them.
- **Record search fans out per request, holds no index, and ranks nothing**
  ([ADR 0040](docs/adr/0040-the-record-search-aggregator.md)). `GET /api/search`
  on the Next host asks each declared source over the same guarded route its
  screens use, carrying the caller's `r10c_at` and nothing else — no service
  token, no elevation, and a tenant-plane source resolves its handle from the
  session exactly as its own routes do, so ADR 0023 stays the one named
  crossing. **A prefetched client index is permanently out**: it is the shape
  that surfaces another organization's record the first time a session's scope
  moves under it. The issue said to fan out through the app's own proxies; that
  is not buildable, because **auth-service has no proxy** — its handlers set and
  clear cookies and cannot be a generic pipe — so the fan-out goes to the
  service base URLs, and what the two paths share is the credential carry
  (`bearerHeader(await sessionToken())`, one place instead of three copies of a
  cookie name). Six things not to re-derive. A source **declares** its search
  and label members, because metadata cannot supply them —
  `linkSearchProperty`/`linkLabelProperty` describe a _referring_ accessor and
  no entity says what it is called — and `defineRecordSearchSource` validates
  the declaration at **module load**, refusing a member that is absent, not
  `filterable`, not `sortable` (the label), or not a **`string`**: an enum
  passes the filterable test and is permanently broken anyway, since `like`
  reaches `coerceValue` and every partial term answers `400`. Every one of those
  failures is silent at both ends, which is `assertSearchable`'s reasoning, and
  the throw is wider here — it fails the app at boot, not one render. A degraded
  source is **named** in `unavailable[]`, deliberately against the issue's
  "surface it as an empty group": an empty group is a confident claim that
  nothing matched, which the server cannot make about a service it could not
  reach — and `reason` splits "not yours" (`forbidden`,
  `noActiveOrganization` — the _normal_ state for an operator, on every
  keystroke) from "unreachable" (`timeout`, `network`, …), because rendering a
  warning for the ordinary case teaches people to ignore it. The fan-out is
  **`Promise.all` over a runner that never rejects**, not `allSettled`, whose
  `rejected` arm is then unreachable and cannot meet the 100% gate honestly;
  concurrency plus a per-source `AbortSignal.timeout` is what makes one slow
  service cost one group **and one timeout of wall clock**. The `401` on a
  missing cookie is **not** redundant with the services' guards —
  `catalog-reference` reads are unauthenticated by design, so without it a
  signed-out caller gets brands back and the answer reads as a real search, and
  the endpoint becomes an anonymous amplifier against `:3100`. Ranking is
  **declared source order plus an explicit `sort=+<label>`**; the services apply
  no default order, so without the sort "ranked" is false and results reshuffle
  as records are rewritten. And there is a **two-character floor**, because a
  `like` is an unanchored `$regex` no index can serve — this endpoint is a
  collection scan by construction, accepted and recorded, with a text index or a
  projection as the named remedy. ⚠️ It needed auth-service corrected first: its
  list route read `page`/`pageSize` and **silently dropped `rsql`**, so a search
  for a name returned the first page of every user presented as matches, and it
  answered a bare `{items,total,request}` no envelope reader could parse. Both
  now match the other three services, which also gave that route the
  `filterable` allowlist it had never had.
- **The AMQP connection heals itself, and nothing else in `amqplib` does.**
  Measured: a channel opened at boot and held in a `Layer` is dead **permanently**
  once the broker restarts — publishes fail forever and a subscriber stops
  consuming while raising nothing ever again. Sharper form: a failed passive
  `checkExchange` _closes the channel_, so the readiness probe was itself a way
  to break the bus for the whole process. `AmqpChannelTag` therefore carries an
  `AmqpConnector` (`withChannel`/`addConsumer`), not a `Channel`: it reopens on
  demand, retries a call once on a dead channel, and **re-registers every
  consumer against the new channel** — a subscriber's exclusive queue died with
  the old connection and nothing else rebinds it. Binding is tracked per channel
  (`Consumer.boundTo`), because a consumer registered while the first connection
  is still opening otherwise binds twice and folds every event twice. Connecting
  stays **eager** at boot so an unreachable broker still fails startup rather
  than leaving a service up with a silently dead bus. The reopen is lazy, so the
  outbox relay's 15s sweep is what heals a dead subscriber — a service that
  consumes but never publishes would not heal on its own.
- **Mongo is a replica set, and dev hides the two things that break in prod.**
  Local runs single-node (`--replSet rs0`), production three; multi-document
  transactions do not exist on a standalone server at all. Dev has no elections
  and no lag, so both rules live in code: drive every transaction with
  **`session.withTransaction`**, never a hand-rolled
  `startTransaction`/`commitTransaction` — an election aborts with a
  `TransientTransactionError` the _application_ is expected to retry, which a
  single-node set never raises — and keep non-transactional side effects
  (the Redis `sequence.next()` code draw) **outside** that retried callback, or a
  retry consumes a second value and gaps the code series. Three traps in the
  conversion: `--replSet` with auth on makes mongod **require** a cluster keyFile
  and refuse to start without one (mounted `defaultMode: 0400` + `fsGroup: 999`,
  since a Secret's default 0644 root-owned projection is rejected);
  `directConnection=true` on the seeded URI is **local only**, because a set
  advertises an in-cluster address the host cannot resolve — against a hosted
  `mongodb+srv://` the same flag pins the driver to one member and defeats
  failover; and initiation is ladder rung **L5b**, never a readinessProbe, because
  `rs.initiate()` needs a live pod while L4 waits for Ready, so a probe demanding
  a primary would deadlock against its own init. Changing the URI seed needs a
  `dev:reset` (`ON CONFLICT DO NOTHING`).
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
  boundary changed: `oidc-client.ts` reads every URL from discovery. **The login
  wears the r10c palette, and it is seeded, not styled**: the v2 image reads
  `GET /v2/settings/branding`, which serves the instance label policy, so
  `ensureBranding` in `tools/zitadel-seed.mjs` PUTs the aurora/midnight hexes and
  then `_activate`s them — a `PUT` alone writes a _preview_ nobody sees, the same
  trap SMTP has. The hexes are duplicated from
  `packages/entifix/style/src/presets/` because that package ships CSS with no TS
  export; changing one is a `ZITADEL_SEED_REVISION` bump like any other seed
  change. Verify it through a real `/oauth/v2/authorize` round trip — opening
  `:30081/ui/v2/login/loginname` bare gives the login no request context and it
  renders its built-in defaults, which are Zitadel's, so a branded instance
  reads as unbranded (measured; a pod restart does not change it, it is not a
  cache). The e2e
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
  asymmetry by scoping it. Consequences: it carries its own REST adapters
  (`config-service-domain`) and its own `/server` proxy factory, because those
  are config-service's and not the base shell's — **not** because the edge is
  illegal, which this file used to claim. `shell:domain` may depend on
  `shell:base` (`eslint.config.mjs:196`) and both domain shells already do; what
  is forbidden is the reverse, so `shells-next-common` may import **no** other
  shell — which is why a shell contributes its nav and its search sources and
  the host concatenates them. The permission-annotated nav vocabulary
  (`GuardedNavItem`/`GuardedNavSection`) lives in
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
  shell's copy is `shell:auth.*`. **The catalog is two backends, so the host
  mounts two proxies**: `ProductSpecification` comes from marketplace-admin-service
  through `/api/admin`, `ProductBrand`/`ProductCategory` from marketplace-service
  through `/api/marketplace` (`marketplace-service-domain`), because ADR 0022 moved
  the platform vocabulary into `catalog-reference`. Composing both from one domain
  key is what left the brand and category pages requesting routes that no longer
  existed — and the e2e fixture, stubbing the same wrong address, could not see
  it, so `back-office-app:dev` now starts marketplace-service too. Reads there are
  unauthenticated by design; authoring stays `super-admin`'s alone, because
  `catalog-reference` is operator-owned, so `user`/`admin` hold
  `catalog-reference:*:read` and nothing more. Three route groups because they **gate**
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
  `ROLE_PERMISSIONS` in `@r10c/business-ts-authz`, never from the token, which
  carries no grant — `roles`, `activeOrganizationId`, `partyRole` and
  `entitlements` are all context or ceilings, resolved to grants at the consumer. Guard a route with `requirePermission(...)` from
  `@r10c/shells-effect-service` (401 vs 403) — **hiding a nav item protects nothing**.
  `PolicyDecisionTag` is the ABAC seam; `canAssignRole` caps role creation at the
  actor's own tier. Creating a user always runs `registerUserUCFactory`, never a
  generic entity write. `unverifiedClaims` reads the cookie **without checking its
  signature** — nav filtering only, never a decision. Gated Next apps need a
  `seedSession` e2e fixture and a `readyPath` outside the matcher. See
  [ADR 0002](docs/adr/0002-authorization-roles-and-abac.md) and
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#authorization-role-aspects--permissions).
- **Navigation has two ceilings now, and one list**
  ([ADR 0037](docs/adr/0037-entitlement-aware-navigation.md)). ADR 0007's second
  assignment ceiling — what the organization was **provisioned for** — had never
  been read by anything: `Entitlement` is an entity, `entitlementSeedData` writes
  a row, and `isPermissionEntitled` sat beside them as a pure function with
  **zero callers**, so an organization provisioned for nothing still saw every
  link. It now rides the access token as an `entitlements` claim resolved once at
  sign-in by `SessionScopeResolver` (already the one place a session's
  organization is decided) and re-signed unchanged on refresh — the `partyRole`
  arrangement exactly, so the refresh path stays store-only. A nav item opts in
  with **`entitled: true`**, a boolean and not a domain name, because the domain
  is already written one line up in `permission` and a second string could
  disagree with what the route behind it checks. **Omitting it is right for most
  items**: nobody is provisioned for `catalog-reference`, `config` or `authn`, so
  deriving the gate would have hidden brands, categories, Configuración and
  Usuarios from every vendor — today exactly one item carries the flag. Four
  things not to re-derive. The skip is keyed on **`activeOrganizationId`, never
  on an empty entitlement list**: platform staff hold no tenant scope and are
  _outside_ the ceiling, while a member of an unprovisioned organization is
  inside it and entitled to nothing — collapsing them empties a super-admin's
  sidebar, silently, with every organization-seeding test still passing.
  `entitled` with no `permission` **throws**, because there is no domain to read
  and both defaults surface as a bug in something else. The claim is **stale
  until the next sign-in** (same as `partyRole`), which is acceptable only while
  this is presentation — **when something enforces the ceiling, revisit the
  bound**, and `RequestPrincipal` gains the field then rather than now, since a
  verified claim nothing consults is the same defect as the endpoint this
  deleted. And `GET /api/menu` + `workspaceMenu` are **gone**: `git log --all -S`
  found no revision in which anything fetched them — the workspace reuses the
  sidebar — so the "second source" was never drift, it was an untested second
  projection waiting to become one. `unverifiedRoles` went with them, since
  `navPrincipal` decodes once with `unverifiedClaims`.
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
  config-service (`marketplace-admin-service/src/observability.ts` is the reference,
  and `marketplace-service`'s copy is byte-identical — edit both).
  **The Effect→tooling bridge in that file had two silent faults, and both are the
  kind that pass every test.** Effect's `LogLevel.label` is **upper case**
  (`"ERROR"`, `"WARN"`, `"DEBUG"`); the mapper switched on `'Error'`/`'Warning'`/
  `'Debug'`, so **no case ever matched** and every log in every service was emitted
  at `info` — an `Effect.logError` reached Loki as `severity_text: INFO`, invisible
  to any level-based alert while still present in the log, which reads as "the
  service has no errors". And `annotations` was destructured away and never
  forwarded, so **every `Effect.annotateLogs` was discarded** — the outbox relay's
  tenant/event id and the engine's transaction id among them, each with a comment
  beside it claiming they were queryable structured fields. Both were found by
  querying Loki during a live pass, not by a test: the e2e's level assertion is
  `expect(['debug','info','warn','error']).toContain(record.level)`, which every
  record satisfied _because_ every record was `info`. `observability.spec.ts` now
  pins each level to its own `severityNumber` and asserts annotations arrive as
  attributes. Note `error` takes `(message, error?, attributes?)` — passing
  attributes positionally as the second argument files them as the cause and loses
  them again — and Effect's own minimum level is `Info`, so a `logDebug` is dropped
  before any logger sees it regardless of the tooling logger's configured `level`.
  See [ADR 0001](docs/adr/0001-observability-and-tooling.md) and [[observability-stack-decision]].
- **One contract, two scales — and the opt-in is an attribute.** Spacing and
  type keep one set of token names and take different values per app: fluid
  Utopia stays the default in `tokens.css` (the storefront keeps it), and
  `presets/fixed-scale.css` carries the 4px-aligned scale with a **14px** body
  for dense operator UI. This works only because Tailwind emits these utilities
  **by reference** (`.p-s { padding: var(--spacing-s) }`), so redefining the
  property re-scales every existing call site — `SpacingToken`, `GAP`, `PADDING`
  and ~150 `p-s`/`gap-2xs` sites were untouched by the whole migration. The
  preset is inert until something opts in (`<html data-scale="fixed"
data-density="compact">`), exactly like `[data-theme]`; properties inherit, so
  a subtree can differ, which is what makes a Storybook specimen showing both
  scales possible. **Density compacts spacing, never type** — shrinking text is
  how a compact mode becomes an accessibility problem — and it is an attribute
  rather than a media query because density is a property of the work, not the
  viewport, so the no-media-query rule stands. `2xl`/`3xl` are exempt (page
  rhythm), as is `[data-density-exclude]` (alerts, help panels, date pickers).
  Three traps that are only visible from the compiled CSS. **A `@theme` shadow
  is baked, not referenced**: Tailwind inlines its color at build time so it can
  offer `shadow-<color>`, which means every palette's `--shadow-*` override in
  this repo was dead CSS from the day it was written — elevation is now four
  plain custom properties (`shadow-edge` ‹ `raised` ‹ `card` ‹ `overlay`) with
  hand-written utilities, and a palette re-tints in one line via
  `--shadow-tint`/`--shadow-strength`. **A custom `@utility` loses to a
  theme-generated one**, which is why those rungs are named for meaning rather
  than reusing `xs`/`sm`/`lg`. And **`focus-ring` must match `[data-focus]` as
  well as `:focus-visible`**, because HeadlessUI drives Radio/MenuItem/
  ComboboxOption with the attribute — without that arm a control has no ring
  while wearing the class that says it does. The typeface (Inter + JetBrains
  Mono) is `next/font/google` **per app, duplicated on purpose**: it is a
  compiler macro, and a workspace library ships as prebuilt `dist`, so the call
  would reach the runtime unprocessed; Storybook loads the same families from
  `@fontsource-variable/*` instead, and those two paths meeting at
  `--font-inter`/`--font-jetbrains-mono` is the seam to check when a specimen
  stops matching the app. Three weights only (400/500/600); `bold` is gone from
  the `Text` API. `tabular-nums` lives in `CellValue` for `number`/`date`, never
  on `--font-sans` — prose needs proportional figures. See
  [ADR 0027](docs/adr/0027-two-scales-a-density-mode-and-the-type-system.md).
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
