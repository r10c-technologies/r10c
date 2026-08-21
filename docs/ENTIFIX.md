# Entifix — entities and the Effect-agnostic use-case

> **Status (2026-07)** — `entifix-ts-core`, `-business`, `-rest-client`,
> `-mongo-client`, and `entifix-react-{controls,integration}` are implemented.
> The `load` and `get` use-cases run end-to-end over both REST and Mongo;
> `save`/`delete` are implemented on the adapters (and the shared serializer) but
> not yet driven by a UI/route. To-one links (`EntityLink`) are resolved on both
> web and backend; to-many (`EntityCollectionLink`) is modeled and deserialized
> but only served as foreign keys so far. The React side now renders through
> `EntityTable`, which builds its columns from the accessor metadata; its filter
> and sort panels are wired end-to-end into the load request over the **RSQL
> query protocol** (§6), from the browser to Mongo. Filtering on links is not
> supported yet.

Entifix is a small entity framework whose entire purpose is to let a **single
use-case** run in any environment. It reaches that goal by combining two ideas:
**decorator-described entities** (so any adapter can read/write an instance
generically) and **[Effect](https://effect.website) dependency injection** (so a
use-case declares what it needs without importing what provides it).

## 1. Entities describe themselves

An entity is a plain class decorated with `@entity()` and `@accessor()`
(`entifix-ts-core`). The decorators register metadata on `MetaEntity` /
`MetaAccessor` via the stage-3 `Symbol.metadata` protocol; free functions read it
back:

```ts
@entity({ domain: 'product-configuration-management', key: 'product' })
export class Product implements Entity {
  #id?: EntityId;
  #code!: string;
  #brand = new EntityLink(ProductBrand); // relation, pre-initialized

  @accessor({ type: 'id' }) get id() {
    return this.#id;
  }
  set id(v) {
    this.#id = v;
  }
  @accessor({ type: 'string', label: 'Code' })
  get code() {
    return this.#code;
  }
  set code(v) {
    this.#code = v;
  }
  @accessor({ type: 'link', label: 'Brand' })
  get brand() {
    return this.#brand;
  } // read-only link accessor
}

extractMetaEntity(Product).key; // → 'product'  (collection / route name)
extractMetaAccessors(Product); // → [{ name:'id', kind:'getter', ... }, ...]
```

This metadata is what makes an adapter **generic**: given only the constructor,
it derives the collection/endpoint name (`key ?? name`) and the field list
(`alias ?? name`, skipping `hidden`). No entity-specific adapter code is needed.

**Authorization reads the same metadata.** A permission is
`` `<domain>:<entityKey>:<action>` ``, so `permissionForEntity(Product, 'read')`
(`@r10c/business-ts-authz`) resolves to
`product-configuration-management:product:read` from the `@entity()` options
alone. Making a new entity guardable therefore needs no new vocabulary anywhere —
the same trick as `filterable`/`sortable` doubling as the server-side query
allowlist. See
[ARCHITECTURE.md → Authorization](./ARCHITECTURE.md#authorization-role-aspects--permissions).

### Presentation metadata

`@accessor()` also carries what generic UI needs to render a member without
knowing the entity: `type` (`MetaAccessorType`: `string | number | boolean | date
| enum | id | link | linkCollection`), `label`, `sortable`, `filterable`,
`order`, `enumValues`, `linkLabelProperty`, `linkSearchProperty`,
`linkSerialization`, `readonly`, and `required`. All are
optional — annotate what the UI should not have to guess. `required` and
`readonly` are what a form reads: `required` blocks submit while the field is
empty, `readonly` disables its input (the member still shows). On a relation,
`required` means "a key must be held" — the format of a foreign key is the
service's business, not the form's.

The three `link*` options are what make a relation editable without bespoke code:
`linkLabelProperty` (default `name`) is what a target reads as,
`linkSearchProperty` (default: the label one) is what a picker filters on — it
must be `filterable` on the **target** entity, since that metadata is also the
server-side allowlist — and `linkSerialization` (`'id'` by default, or
`'embedded'`) is the shape the relation writes back as. That last one belongs on
the entity because the serializer inlines whatever link `isLoaded`: without a
declaration, the wire shape would depend on whether the UI happened to hold the
target.

`describeEntityColumns(Ctor, sample?)` resolves them into `EntityFieldDescriptor[]`
— the contract generic UI builds itself from: a table's columns (`EntityTable`)
and now a form's fields (`EntityForm`). It keeps getter-kind, non-`hidden`
accessors (unlike serialization it _keeps_ `readonly` ones: a read-only member is
still displayable, and the descriptor surfaces `readonly`/`required` for the
form), fills a label by humanizing the name, defaults `sortable`/`filterable` on
for scalars and off for `id`/links, and infers an undeclared `type` from the
optional sample row (`EntityLink` → `link`, `Date` → `date`, `typeof` →
number/boolean, else `string`). Declared always beats inferred.

### Serialization is shared and transport-agnostic

`entifix-ts-core` owns the (de)serializer, so REST and Mongo round-trip the
identical wire shape:

- `deserializeSingleEntity(Ctor, plain)` — `new Ctor()`, then for each writable
  getter assign the raw value; link accessors are populated in place.
- `serializeEntity(Ctor, instance)` — the inverse: walk the getters, emit
  `alias ?? name`, collapse links (see below), omit `undefined`.

Because both live in core, a document written by the Mongo `save` adapter reads
back through the same code the REST client uses on the browser.

## 2. Links model relations two ways

A raw payload can express a relation as a **foreign key** (just the id) or as
**embedded data** (the full object inline). `EntityLink<T>` /
`EntityCollectionLink<T>` capture both and resolve lazily:

- deserialize: an object → deserialized instance (`isLoaded`); a scalar → stored
  as the link id.
- serialize: `isLoaded` → embedded object; otherwise → the scalar id.

Resolution is itself an Effect, and the resolver is **injected** so links stay
environment-agnostic. Because `core` may not depend on `business`, `EntityLink.reload`
takes the resolver as an argument (a core interface) rather than reading a tag:

```ts
export interface EntityLinkResolver {
  resolve<T extends Entity>(Ctor: EntityConstructor<T>, id: EntityId): Effect<T, EntifixError>;
}
link.reload(resolver); // fetches + caches the target
```

### Writing a relation back: `applyEntityLinks`

The inverse of resolution. A form's draft is `Record<string, string>` — it has to
stay JSON, because a workspace tab autosaves it — so a relation is held as its
foreign key, and an id alone cannot express the embedded shape. Two pieces close
that gap, both pure and in `core`:

- **`applyEntityLinks(instance, descriptors, values, selection?)`** writes every
  `link` member of a freshly built entity, following each one's declared
  `linkSerialization`: `embedded` gets the picked instance (`setValue`, so the
  serializer inlines it), `id` gets only the key (`setId`) **even when the instance
  is at hand**. An empty draft value clears the link.
- **`selection`** (`EntityLinkSelection`, keyed by accessor name) is the sidecar
  holding those instances — seeded from a record's already-materialized links by
  `seedEntityLinkSelection` and extended by each pick. It is a _cache_: a missing
  entry costs the embedded shape, never the relation.

`linkCollection` members are left untouched — the to-many editor is a follow-up,
and that is the branch where `setIds`/`setValues` will land.

The browser half of this (the two-mode picker, the source port) is in
[FRONTEND.md → Editing a relation](./FRONTEND.md#editing-a-relation).

## 3. Effect makes the use-case agnostic

This is the crux. A use-case never receives a repository or a resolver as an
argument or an import — it **yields a `Context.Tag`**, and Effect tracks that
requirement in the type. `entifix-ts-business` defines the tags
(`EntityRepositoryTag`, `EntityLoadRequestTag`, `EntityIdTag`,
`EntityLinkResolverTag`) and the factories:

```ts
export const loadProductsUCFactory = () =>
  Effect.gen(function* () {
    const repository = yield* EntityRepositoryTag; // ← required, not imported
    const loadRequest = yield* EntityLoadRequestTag;
    const resolver = yield* EntityLinkResolverTag;

    const page = yield* repository.load<Product>(loadRequest);
    yield* Effect.forEach(page.items, product => (product.brand.isLoaded ? Effect.void : product.brand.reload(resolver)), { concurrency: 'unbounded', discard: true });
    return page;
  });
```

The type of this Effect is
`Effect<EntityPage<Product>, EntifixError, EntityRepositoryTag | EntityLoadRequestTag | EntityLinkResolverTag>`.
That `R` channel is a **compile-time contract**: the program will not typecheck
until every tag is provided. There is no reflection, no runtime container, no
"cannot resolve dependency" at startup — a missing adapter is a red squiggle.

### Providing the tags at the edge

Only the composition root knows the environment, and it discharges the tags:

```ts
// Web (a Next page)
loadProductsUCFactory().pipe(
  Effect.provideService(EntityLoadRequestTag, { page, pageSize }),
  Effect.provide(productRestContext),                       // EntityRepositoryTag ← REST
  Effect.provide(useEntityLinkResolver(cfg, [[ProductBrand, brandRest], ...])),
);

// Backend (marketplace-admin-service route)
loadProductsUCFactory().pipe(
  Effect.provideService(EntityLoadRequestTag, { page, pageSize }),
  Effect.provideService(EntityRepositoryTag, makeMongoRepository(db, Product)),
  Effect.provide(makeMongoLinkResolver(db, [ProductBrand, ProductCategory])),
);
```

Same use-case, same links, same serializer — **only the four lines at the edge
change**. Swapping REST for Mongo (or later a cache) is a composition-root edit;
the business logic is untouched. That is the whole point of entifix.

### A named verb is a class: `@useCase()`

The factories above are anonymous — they carry no key, no label and no
permission of their own, which is why entifix generated UI from entities alone.
A verb beyond the `read`/`write`/`delete` triple is declared instead as a
**class**, because stage-3 decorators apply to classes, methods, fields and
accessors and never to a standalone function
([ADR 0026](adr/0026-the-use-case-descriptor-and-served-entity-metadata.md)):

```ts
@useCase({
  entity: UserIdentity,
  key: 'revoke-sessions',
  binding: 'entity',                     // 'entity' | 'collection' | 'unbound'
  placement: 'context-independent',      // where a surface puts it
  labelKey: 'entity:user-identity.useCases.revokeSessions',
  confirm: { tone: 'destructive', messageKey: '…revokeSessionsConfirm' },
})
export class RevokeUserSessionsUC {
  static run() {
    return Effect.gen(function* () { … });  // tags, exactly as above
  }
}

export const REVOKE_SESSIONS = permissionForUseCase(RevokeUserSessionsUC);
```

Four things follow, and each has bitten:

- **`placement` is not derivable from `binding`.** An entity-bound action can be
  determining (a footer "Publish" that finalizes the page) or
  context-independent (a toolbar action available whenever a record is open).
- **Every human-readable member is a catalog key**, never copy —
  `react/jsx-no-literals` fails the build on a string written into JSX, so a
  descriptor carrying a sentence could not be rendered. `keywordsKey` is a key
  rather than a `string[]` so an English term reaches a Spanish command.
- **Write the descriptor inline.** `@useCase({ ...DESCRIPTOR })` compiles and
  makes the source scan in `@r10c/slices` stop seeing the declaration, which
  turns every invariant below into a vacuous pass.
- **Export the class from its package barrel.** A `@useCase()` registers itself
  onto its entity when its module evaluates, so a class nothing can import
  leaves `describeEntityUseCases` returning `[]` — an entity that silently reads
  as having no actions. `@r10c/slices` fails the build on it, along with a verb
  no `ROLE_PERMISSIONS` grant names, a grant naming a verb nothing declares, and
  two implementations of one verb.

`saveUCFactory`, `deleteUCFactory`, `getUCFactory` and `loadUCFactory` stay plain
functions. They are not use cases in this sense — they _are_ the CRUD triple.

`permissionForUseCase` has a second, two-argument form
(`permissionForUseCase(UserIdentity, 'revoke-sessions')`) for a caller holding
only the entity. Prefer the one-argument form: it is what keeps the verb string
written once. The grant table is the exception and has no choice —
`business:policy` may not import a domain package, so it repeats the literal and
the source scan is what keeps the two in step.

## 4. Adapter contract, precisely

```ts
interface EntityRepository {
  get<T extends Entity>(id: EntityId): Effect<T, EntifixError, ConfigurationRepositoryTag>;
  load<T extends Entity>(req: EntityLoadRequest<T>): Effect<EntityPage<T>, EntifixError, ConfigurationRepositoryTag>;
  save<T extends Entity>(entity: T): Effect<T, EntifixError, ConfigurationRepositoryTag>;
  delete<T extends Entity>(idOrEntity: EntityId | T): Effect<void, EntifixError, ConfigurationRepositoryTag>;
}
```

- **REST adapter** builds the endpoint from `key`, fetches, deserializes; it
  reads its base URL from the `ConfigurationRepositoryTag` store.
- **Mongo adapter** — `makeMongoRepository(db, Ctor)` closes over the connected
  `Db` and the constructor, so each method's Effect requires _nothing_ (`R = never`,
  assignable to the interface). It translates `EntityFiltering`/`EntitySorting`/
  pagination to a Mongo query (`filter-translator`), then reuses the shared
  (de)serializer. `MongoDatabaseLayer` provides the connection as a scoped Layer
  (closed on shutdown); `makeMongoLinkResolver` builds an `EntityLinkResolver`
  from the same adapters.
- **SQL adapter** — `makeSqlRepository(sql, Ctor)` (`@r10c/entifix-ts-sql-client`)
  is the relational mirror, and it is short for the same reason the Mongo one is:
  `serializeEntity` already emits a **flat record keyed by `alias ?? name`**, which
  for a scalar entity _is_ a table row. **So an accessor's `alias` is the column
  mapping** — there is no table/column mapping layer, and none is needed. Table
  name follows the same `key ?? class name` rule. v1 handles flat scalar entities:
  embedded links and `linkCollection` have no single-column form.

  `sql-filter-translator` mirrors `filter-translator` but emits **parameterized**
  `@effect/sql` fragments — column identifiers go through `sql(name)`, which the
  compiler quotes, and are validated against the entity's own
  `filterable`/`sortable` allowlist (`allowedDescriptors`) **before** interpolation.
  Two dialect assumptions, stated so a future MySQL/SQLite adapter knows what to
  override: `ILIKE` for case-insensitive matching and `COUNT(*)::int` for the total.
  The client must not be configured with `transformResultNames` — `alias` is
  already the mapping and a second one would fight it.

  Its unit suite asserts on **compiled SQL** (`[sql, params]`) through a fake
  driver. The shared `describeEntityRepositoryContract` needs a real engine, so it
  runs against real Postgres rather than in the unit gate — the same treatment the
  driver connection Layers get.

Errors are always an `EntifixError` subclass — `EntifixConnError` (transport),
`EntifixBuildError` (mapping/deserialization), `EntifixLogicError` (e.g. an
unregistered resolver).

### The envelope is the message

Every message on the wire is an `EntifixEnvelope`: `{ meta, data }`, built in
`entifix-ts-core` (`src/envelope/make-envelope.ts`) and therefore transport-free —
the same shape goes over HTTP, over the bus, and into a test double.

`meta.type` is one of `entity`, `entityCollection`, `entityPage`, `command` or
`transactionEvent`, and `meta.entity` is the **routing label**: `key ?? class
name`, resolved by `envelopeEntityName` — the identical resolution the REST
adapter uses to build an endpoint and the Mongo adapter uses to pick a
collection. One rule, three consumers, so a renamed `key` cannot move the
endpoint without moving the envelope with it.

Four builders wrap the shared serializer, which is why a route never hand-rolls a
payload:

| Builder                        | `meta.type`        | `data`                        |
| ------------------------------ | ------------------ | ----------------------------- |
| `makeEntityEnvelope`           | `entity`           | one serialized entity         |
| `makeEntityCollectionEnvelope` | `entityCollection` | serialized entities           |
| `makeEntityPageEnvelope`       | `entityPage`       | `{ items, total, request }`   |
| `makeEnvelope`                 | any                | a caller-defined `data` shape |

`makeEnvelope` is the escape hatch for payloads that are **not** serialized
entities — a `command` or a `transactionEvent` carries a shape the transactions
layer defines, so it cannot go through the entity builders. It still takes an
`entity` label, because routing does not stop applying just because the body is
not an entity.

Optional `meta.links` carry `EntifixEnvelopeLink`s, which is how a `202` points
at the transaction it started.

## 5. The React side

`entifix-react-integration` runs a use-case against an adapter context inside a
component: `useDataLoading({ uc, ctx })` executes the Effect and exposes
loading/data/error; `useEntityLinkResolver(configStore, registrations)` builds the
resolver context at the page level. The page is the composition root; the organism
and the use-case never learn the transport.

`entifix-react-controls` provides the UI, split in two: entity-agnostic
primitives (`Table`/`TableRow`/`TableCell`, `Button`, `Select`, `Pagination`, …)
and the **`EntityTable`** organism built on them.

`EntityTable` takes an `entityConstructor` and derives everything else from
`describeEntityColumns`: which columns exist, their labels, and how each value
renders (`CellValue` formats by `type` — a `date` localizes, a `link` reads as
its target's label or its foreign key). Listing a new entity is one tag.

Three things layer on top of that default:

- **Personalization** — column order and visibility, read/written through the
  `UiPreferencesState` port (`read`/`write`/`remove`, all Effect-returning). The
  shipped adapter is `makeLocalStorageUiPreferencesState(namespace)`; the port is
  async-capable on purpose, so a server-backed per-user store is a drop-in swap at
  `UiPreferencesProvider`. Keys are `<namespace>:<component>:<scope>`, e.g.
  `r10c-ui:entity-table:product`. A stored layout degrades rather than breaks:
  stale names are dropped and columns added to the entity later append at the end.
- **Responsiveness** — below `pivotBreakpoint` (default `md`) rows pivot into
  label/value cards. Both layouts are rendered and CSS picks one, driven by the
  same resolved columns; a JS breakpoint hook would have to guess during SSR and
  correct after mount, which is a hydration mismatch on every load.
- **Slots** — children are configuration expressed as JSX, matched by component
  identity (not `displayName`, which minifiers rewrite):

  ```tsx
  <EntityTable entityConstructor={Product} {...pager}>
    <EntityColumn<Product> field="brand" label="Maker" render={p => <b>{p.brand.value?.name}</b>} />
    <EntityTableHeader render={columns => <tr>…</tr>} />
    <EntityTableRow render={(item, columns) => <tr>…</tr>} />
    <EntityTableToolbar>
      <Button>Export</Button>
    </EntityTableToolbar>
  </EntityTable>
  ```

  An `<EntityColumn>` naming a member the entity does not have becomes a computed
  column. Unmatched children render below the table.

The toolbar's filter and sort panels are also metadata-driven: the member list is
the `filterable`/`sortable` descriptors, the operators offered come from the
member's `type` (the const arrays in `EntityFiltering.ts` — no substring matching
on a number), and the value control follows suit. They emit `FilterGroup<T>` /
`EntitySorting<T>` through `onFilteringChange`/`onSortingChange`.

Both panels **commit** rather than stream: editing is local draft state and the
callback fires only on **Apply** (or **Clear**, which applies the emptied form).
The value feeds a load request, so emitting per keystroke would put one HTTP
request on the wire per character typed.

`useDataLoading` holds the applied filtering/sorting and puts them in the load
request, resetting to page 1 on every change — page 3 of the old result is
usually past the end of the narrowed one. The fetch effect keys on the
**serialized** query rather than on object identity: callers rebuild these
objects on every render, so keying on identity would refetch forever (the same
trap the `uc`/`ctx` refs in that hook exist to avoid).

## 6. The RSQL query protocol

Filtering and sorting travel from the REST client to the service as query
parameters, and the codec for them lives in `entifix-ts-core` (`src/rsql/`) —
the one package both the browser adapter and an Effect service already depend
on. **RSQL** is the standard for the filtering half; sorting gets a companion
`sort` parameter, since RSQL standardizes no sort grammar.

```
GET /api/product-brand?rsql=name%3Dlike%3DAcme%3Bstock%3Dgt%3D10&sort=%2Bname%2C-code&page=1&pageSize=10
                decoded   rsql=name=like=Acme;stock=gt=10        sort=+name,-code
```

| entifix | RSQL   | entifix     | RSQL            |
| ------- | ------ | ----------- | --------------- |
| `eq`    | `==`   | `in`        | `=in=(a,b)`     |
| `ne`    | `!=`   | `nin`       | `=out=(a,b)`    |
| `gt`    | `=gt=` | `between`   | `=btn=(a,b)`    |
| `gte`   | `=ge=` | `nbetween`  | `=nbtn=(a,b)`   |
| `lt`    | `=lt=` | `like`      | `=like=`        |
| `lte`   | `=le=` | `nlike`     | `=nlike=`       |
|         |        | `isNull`    | `=isnull=true`  |
|         |        | `isNotNull` | `=isnull=false` |

`;` is and, `,` is or (and binds tighter), `(…)` groups. The first six plus
`=in=`/`=out=` are standard RSQL; the rest are entifix extensions written in the
same `=word=` shape so a generic tokenizer still splits them. `isNull` and
`isNotNull` share one token because RSQL has no unary comparison, and are told
apart by the boolean argument.

**Values go out untyped.** Numbers and booleans are written bare, everything else
single-quoted (`\'` and `\\` escaped), dates as ISO-8601. The parser therefore
returns strings and a separate step re-types them — so the URL stays readable and
the server never trusts a type the client declared.

`sort=+name,-code`: the sign is the direction, the list position is the
`EntitySorting` numeric priority.

### The trust boundary

`coerceFiltering(Ctor, parsed)` / `parseSort(Ctor, param)` are where an inbound
query stops being a string a client chose. Both resolve every property against
`describeEntityColumns(Ctor)` and reject — as `EntifixBuildError`, which services
map to a `400` — anything that is not a member the entity declared `filterable`
(resp. `sortable`). That is what stops a client filtering on a `hidden` member or
an unindexed field. Values are coerced to the member's declared type and rejected
if they do not fit; the property is rewritten to the descriptor's `key`, which is
also the stored field name. The parser additionally caps nesting depth and node
count, so a crafted URL cannot exhaust the stack or become an enormous query.

### The round trip

```
FilterBuilder ──emit on Apply──▶ useDataLoading (applied state, page → 1)
     │
     ├─ serializeLoadRequestParams ──▶ ?rsql=…&sort=…&page=…&pageSize=…
     │        (buildEntityRestAdapterLoad)
     ▼
  service: parseLoadRequestParams(Ctor, search)
     = parseRsql → coerceFiltering (allowlist + typing)
     + parseSort (allowlist)
     ▼
  loadUCFactory → makeMongoRepository
     = translateFiltering / translateSorting → Mongo find + countDocuments
```

Both ends of the URL are the _same_ module, so what the client composes is by
construction what the service parses. Adding an operator means adding it to
`EntityFiltering.ts`, `rsql-operators.ts` and `filter-translator.ts` — and the
core round-trip spec (`serialize → parse → coerce` deep-equals the original) is
what catches a half-done addition.

**Not supported yet**: filtering or sorting on a link (`EntityLink` descriptors
default to `filterable: false`; Mongo would need a join or a denormalized field),
free-text search across members, and a Postgres translator.

---

**Layering note.** `core` cannot import `business` or `shells`. That constraint is
why the resolver is a core interface passed into `reload`, and why the tags live
in `business`. When bundling a service that imports entity _values_, every entity
package must carry a stage-3 `.swcrc` and `tslib` must be externalized — see
`CLAUDE.md` and the project memory `node-service-consuming-entifix-libs`.
