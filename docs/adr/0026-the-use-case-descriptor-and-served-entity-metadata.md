# 26. The use-case descriptor, and entity metadata as a served document

- Status: Accepted
- Date: 2026-08-19
- Revised: 2026-08-20 — two facts found while building it (#118): the decorator
  writes two metadata bags rather than one, and `permissionForUseCase` gained a
  one-argument form; grants cannot import the constant it derives.
- Revised: 2026-08-21 — four facts found while building the delivery half (#157):
  the document carries `actions` beside `useCases`; the ETag hashes the computed
  document, not the descriptor set; an unreadable entity answers `404`, not
  `403`; and the route mounts per entity at a **literal** path, because a
  parametric one is shadowed by `/:id` and never runs.
- Amended by: [ADR 0035](0035-entity-actions-selection-and-bulk.md) — this
  record's "one vocabulary, three surfaces" built one of them, and four of the
  nine `binding × placement` cells were dropped in silence. 0035 maps every
  cell, rejects the one no surface owns, and adds the selection and per-row
  bulk result the collection surfaces need. Its decisions on `Clone` and on the
  action-segment wildcard **uphold** this record's rather than changing them.

## Context

Entifix's claim is that it generates UI from **entities and their use cases**.
It generates UI from entities only. A use case has no descriptor, no permission
of its own, and nowhere to be declared.

The blocker is one line:

```ts
// packages/business/ts/authz/src/values/permission.ts:9
export const Actions = ['read', 'write', 'delete'] as const;
```

`permissionForEntity(Ctor, action)` accepts nothing else, so `publish`, `clone`,
`approve`, `cancel` and `reserve` have no permission they can name. The
`Permission` _type_ (`` `${string}:${string}:${string}` ``) would accept them;
only the const narrows it.

The surfaces show the same absence. `EntityForm` hardcodes its actions —
Save, Delete, Back — inline in the `editing` branch, fed by
`onSubmit`/`onDelete`/`isSaving`/`isDeleting`, and the form has exactly one slot
(`EntityField`), so a page wanting "Publish" has nowhere to put it except
outside the card. `EntityTable` is worse: `hasRowAction = onSelect !== undefined
|| hrefFor !== undefined` and a single `recordAction` per row. There is no
checkbox column, no selection state, no select-all and no row menu. Bulk is not
a feature to extend; it is absent.

And a use case carries no identity at all, because it is a plain exported
function:

```ts
// packages/business/ts/authn/src/use-cases/register-user/register-user.uc.ts:62
export function registerUserUCFactory() { … }

// packages/entifix/ts/business/src/use-case/save/save.uc.ts:19
export function saveUCFactory<TEntity extends Entity>() { … }
```

OData and Fiori settled this taxonomy long ago, and it maps onto our surfaces
without adaptation. An action is **bound to an entity** (one record —
`EntityForm`), **bound to a collection** (the selection — the table's bulk bar),
or **unbound** (nothing — "start a new sale", the command palette). Its
placement is **context-dependent** (needs a selection), **context-independent**
(toolbar, always) or **determining** (footer, finalizes the page). One
vocabulary, three surfaces.

This record decides the descriptor, how a use case is declared and discovered,
how its permission derives, what happens to the wildcard grant, and how the
descriptor reaches a browser without dragging a server implementation with it.

## Decision

### The descriptor lives in core, beside `EntityFieldDescriptor`

```ts
export interface UseCaseDescriptor {
  key: string;
  binding: 'entity' | 'collection' | 'unbound';
  placement: 'context-dependent' | 'context-independent' | 'determining';
  labelKey: string;
  keywordsKey?: string;
  confirm?: { tone: 'destructive' | 'neutral'; messageKey: string };
  form?: string;
}
```

Two members the obvious sketch omits, and both are load-bearing.

`labelKey` is not optional and is a **namespace-qualified catalog key**, the
`GuardedNavItem` convention. i18n is mandatory here and
`react/jsx-no-literals` fails the build on a string written into JSX, so a
descriptor that carried copy could not be rendered.

`keywordsKey` exists because the palette must match across locales: a user
typing an English term should reach a Spanish command. Synonyms are therefore
catalog data resolved in the browser, not an array of strings in code.

`placement` is **not** derivable from `binding`. An entity-bound action can be
determining (a footer "Publish" that finalizes the page) or context-independent
(a toolbar action available whenever a record is open). Collapsing them would
force every surface to re-derive a placement the author already knew.

What deliberately does **not** go here: the members a clone resets. That belongs
on `@accessor({ resetOnClone: true })`, where the member is, rather than as a
per-verb payload on a descriptor that would then grow a union member per verb.

### A use case is a class, and `@useCase()` is a real decorator

Stage-3 decorators — the only kind this repo uses — apply to classes, methods,
fields and accessors. `entity.ts:6` takes a `ClassDecoratorContext`;
`accessor.ts:9` takes a getter/setter context. **There is no standalone-function
decorator**, so `@useCase() export function publishUC()` does not parse. Making
the use case a class is what makes annotation possible at all, and it is why the
alternative — a `defineUseCase(descriptor, factory)` wrapper — was rejected: it
would have to attach a plain property rather than `Symbol.metadata`, and writing
entity metadata outside a decorator is the one thing this codebase has committed
to never doing.

```ts
@useCase({
  entity: ProductSpecification,
  key: 'publish',
  binding: 'entity',
  placement: 'determining',
  labelKey: 'entity:product-specification.publish',
})
export class PublishSpecificationUC {
  static run() {
    return Effect.gen(function* () { … });
  }
}
```

The decorator writes `context.metadata`, identically to `@entity()`.

> **Revised 2026-08-20.** It writes **two** bags, and the second one was not
> foreseen here. The descriptor goes onto the **entity's** metadata, because
> that is what a form or a table holds; the entity/verb pair goes onto the
> **use-case class's own** metadata, which is what makes the one-argument
> `permissionForUseCase` below possible. Appending to another class's bag also
> needs the target's _own_ metadata rather than the inherited lookup every other
> `extract*` helper uses: `Symbol.metadata` resolves along the prototype chain,
> so a plain read would register the verb on a base class and leak it to every
> subclass.

`saveUCFactory`, `deleteUCFactory`, `getUCFactory` and `loadUCFactory` stay
generic functions and are **not** decorated. They are not use cases in this
sense — they _are_ the `read`/`write`/`delete` triple every entity has
implicitly. Wrapping them in classes would buy metadata for verbs that already
have permissions.

### The action segment opens; the CRUD triple keeps its name

`Action` stays `read | write | delete`. A use-case verb is a per-entity string,
and `permissionForUseCase(Ctor, key)` derives `<domain>:<entityKey>:<key>` after
checking that the entity actually declares that use case, throwing
`EntifixBuildError` the way the existing missing-`domain` check already does.

> **Revised 2026-08-20.** There are two forms, and the one this record names is
> the secondary one. `permissionForUseCase(SomeUC)` — a single argument, the
> use-case class — is what call sites use, because the class already knows both
> the entity and the verb, so the verb string is written exactly once, in the
> decorator, and every guard imports the derived constant. The two-argument form
> stated above is kept for the `$metadata` route, which walks an entity's
> descriptors and holds no use-case class.
>
> The one place that still repeats the string is the grant table, and it has no
> choice: `role-permissions.ts` is `business:policy`, which may depend only on
> `layer:entifix`/`layer:utils`, so it cannot import from the domain package
> that declares the verb. The source scan below is what holds the two together —
> which is why "every declared verb appears in at least one grant" is a real
> check rather than a tidiness one.

Rejected: widening `Actions` into one global union that every domain appends to.
It makes an unrelated domain's verb assignable everywhere and grows without
bound.

The check is deliberately at **runtime**, not compile time, because compile-time
narrowing is not available across a decorator boundary — `Symbol.metadata`
erases types, and `extractMetaEntity` returns an untyped `MetaEntity`. Nothing
is lost that existed: `parsePermission` appears to typo-check and does not, since
it casts `segments[2] as Action` (`permission.ts:72`). The real narrowing has
always been at the `permissionForEntity` call sites, and this preserves it in the
form the boundary permits.

### The wildcard keeps its current semantics, and the residual is recorded

Issue #99 warned that a new verb is a silent privilege escalation for every
wildcard holder. Measured against `role-permissions.ts`, that is not true today.
The only grant with `*` in the **action** segment is `super-admin: '*:*:*'`.
Every other wildcard sits on the entityKey segment —
`product-configuration-management:*:write` — where `write !== publish`, so a new
verb reaches super-admin alone. That tier is documented as "the developer tier:
everything, including future tooling not yet modelled", which is precisely this
behaviour.

So the escalation is latent, not live, and `permissionMatches` is unchanged.

**Rejected: a CRUD-only action wildcard.** Making `*` in the third segment cover
only `read|write|delete` would cost `super-admin` its one-line grant, in exchange
for a risk no current grant carries — and it would leave `*` meaning different
things in different segments, which is harder to hold in the head than the thing
it prevents.

**Residual, recorded so it is not rediscovered.** The danger is a future tidy-up.
Three lines of `catalog:*:read`, `catalog:*:write`, `catalog:*:delete` will
eventually look verbose and become `catalog:*:*`; that line then absorbs every
verb the domain later declares, in a commit that touches only an entity file and
contains no permission string. The checks below do not prevent it — they only
require that a verb be granted somewhere, not that the grant be narrow. **If any
role other than `super-admin` ever wildcards the action segment, reopen this
decision.**

### Entity metadata is served, per entity, and it is authorization-shaped

`GET /api/<entity>/$metadata` answers a new envelope type:

```ts
export type EntifixEnvelopeType = 'entity' | 'entityCollection' | 'entityPage' | 'command' | 'transactionEvent' | 'entityMetadata';
```

This is the extension the discriminant was built for — the transactions layer
already added `command`/`transactionEvent` on the stated principle that "core
only owns the discriminant so every artifact agrees on it". The document's
`data` shape, `EntityMetadataDocument`, lives in core beside the descriptor.

**The document carries `actions` beside `useCases`**, which this record did not
originally say. Save and Delete are the three most common affordances on any
screen and they have no descriptor, so a document of verbs alone would leave a
form rendering its buttons unconditionally and describe only the rare half of
the surface. `ENTITY_ACTIONS` therefore moved down from `business-ts-authz` into
core, and authz aliases it: `entifix-react-controls` reads the same triple off
the served document, and `entifix:react` may not import the business layer.

**The route mounts per entity at a literal path.** `HttpRouter` resolves through
`find-my-way-ts`, where a static segment beats a parametric one and there is no
backtracking once the parametric branch has matched. A `/api/:entity/$metadata`
route registered alongside an existing `/api/<entity>/:id` therefore **never
runs**: the by-id handler wins with `id === "$metadata"`, misses, and answers its
own `404` — an endpoint that appears mounted and silently reads as "this entity
has no metadata". Measured both ways. So `shells-effect-service` exports
`entityMetadataRoute(Ctor)` and each service registers it for each of its own
entities; it cannot be a `withHealthRoutes`-style wrapper.

**Divergence from OData, named.** OData's `$metadata` is one CSDL document per
_service_, describing every entity set. Ours is per entity, because
`EntifixEnvelopeMeta.entity` is defined as "the target entity's `key`" and a
service-wide document would have to carry an `entity: '*'` wart through a
contract every artifact reads. The cost is real and accepted: a master-detail
screen fetches one document per entity it renders, so the control layer caches
per entity and a screen with a table plus two pickers issues three requests
before it can render actions.

**The document is authenticated and permission-filtered**, and that is the
security half of this decision rather than a detail of it. The document names
domains, entity keys and verbs — a map of the model — so anonymous access would
hand it over. Filtering runs in the service, through `PolicyDecisionTag`, against
the **verified** principal. That is a strict improvement on what exists: nav
filtering today calls `can()` in the browser against `unverifiedRoles`, which
reads the cookie _without checking its signature_. Serving affordances makes
"what can I do" and "what will the service permit" one computation instead of two
lists that drift.

**An entity the caller may not read answers `404`, exactly as one this service
does not host.** A `403` would confirm the entity exists to somebody not allowed
to see it, which turns the endpoint into an oracle for the model — the very thing
authenticating it was for.

Because the response varies by principal it is `Cache-Control: private` and
`Vary: Cookie, Authorization` — **both** carriers, because the service shell
accepts the access token from the `r10c_at` cookie or an `Authorization: Bearer`
header, and a cache keyed on one would serve across the other.

The ETag hashes the **computed document**. An earlier draft of this record said
"an ETag over the descriptor set", which is wrong: that hash is identical for two
principals with different grants, so a shared `If-None-Match` would `304` one
caller onto another's affordances. Hashing the permission set instead would read
`ROLE_PERMISSIONS` directly and bypass `PolicyDecisionTag`, letting an injected
ABAC policy change affordances without changing the tag. Computing first costs a
metadata read and a handful of pure `decide` calls — no IO — and is exact by
construction.

Hiding an action still protects nothing. `requirePermission` on the route remains
the enforcement, exactly as before; this changes where _visibility_ is computed,
not where authorization happens.

### Columns stay local; use cases come over the wire

This looks like an inconsistency and is not.

`describeEntityColumns` is called **synchronously** from `coerce-rsql.ts:25`,
where the same descriptors are the server-side filter allowlist. RSQL coercion is
framework-free core that runs on a backend as well as in a browser; making it
async would infect the entire query path to serve a UI concern.

The principled line underneath: a column is a property of the class the client
already holds — static, and identical for every caller. A use case's
_availability_ is a property of the deployment and of the caller. Static and
universal on one side, contextual and permission-dependent on the other. The two
belong in different places for the same reason `ROLE_PERMISSIONS` is not baked
into the access token.

### The index is read from source, never from metadata

`tools/slices/src/source-scan.ts` already states the reasoning and this record
adopts it verbatim: metadata is reachable only through a package's barrel, so a
class that exists but was never exported is invisible to a metadata-based check
and every invariant passes vacuously.

`declaredUseCases()` joins `declaredEntityDomains()` there — a regex over
`@useCase({ … })` across `packages/business/ts`, with a pinned expected count like
its neighbours, so a regex that stops matching fails loudly instead of passing
vacuously. What it then asserts:

- every declared `key` has exactly one `@useCase()` implementation, and every
  implementation names an entity that declares it;
- every declared verb appears in at least one `ROLE_PERMISSIONS` grant, and no
  grant names a verb no entity declares;
- no two use cases on one entity share a `key`.

`labelKey` and `keywordsKey` resolving in both catalogs is `@r10c/i18n-check`'s
job, on its existing unconditional-in-CI footing — a missing key is symmetric
across locales, so parity cannot see it.

### What this corrects elsewhere

**Amends [ADR 0003](0003-i18n-mandatory.md)** on one sentence. Its section
"Entity labels are keys carried in metadata, resolved in the browser" closes with
"No metadata endpoint had to be invented", which stops being true here. The
decision it supports is untouched: the served document carries **keys**, never
copy, so translation still happens in the browser and `describeEntityColumns`
still never resolves. `docs/I18N.md` and
`packages/entifix/ts/i18n/src/resources/es/entity.ts` carry the same claim and are
corrected in the same commit.

**Amends [ADR 0014](0014-entity-specifications-and-the-characteristic-dictionary.md)**
by supplying a mechanism it needed and did not name. That record commits to
`EntityForm` accepting `fields: EntityFieldDescriptor[]` beside
`entityConstructor` — runtime-supplied descriptors for vendor-authored
`EntitySpecification`s — but names no way for those descriptors to reach a
browser. This is that way, and it is why the served document is defined over
descriptors generally rather than over use cases alone.

This record **extends [ADR 0002](0002-authorization-roles-and-abac.md) and
supersedes nothing**. `<domain>:<entityKey>:<action>` is unchanged, and 0002
never pinned `<action>` to three values — the `Actions` const did.

## Consequences

**Good.**

- The three surfaces blocked on this — form actions, the table's bulk bar, the
  command palette — read one list in one vocabulary.
- Affordances are computed from a verified principal instead of an unsigned
  cookie, and cannot disagree with what the route enforces.
- No use-case implementation reaches a client bundle. The browser fetches
  descriptors; the `Effect` body, its repository tags and its whole import
  closure stay on the service.
- A use case carries its own identity, so "which use cases exist" is a source
  scan rather than an import graph — the failure mode where an unimported module
  silently renders as "this entity has no actions" cannot occur.
- ADR 0014's vendor-authored specifications gain the delivery path they lacked.

**Bad, and accepted.**

- Per-entity documents mean N fetches for an N-entity screen. Mitigated by
  per-entity caching and ETags, not eliminated.
- Rendering actions is now asynchronous where rendering fields is not. Every
  action surface needs a loading state; `LoadingBoundary` (#117) is the place.
- The verb allowlist is a runtime throw, so a typo surfaces at module load rather
  than at compile time.
- The wildcard collapse described above stays writable. This record chose to
  document it rather than spend mechanism on it, and named the condition that
  reopens the decision.
- `$metadata` is a second public surface per service whose filtering is a
  security boundary, joining `/api/config`'s redaction in that category.
