# Entifix — entities and the Effect-agnostic use-case

> **Status (2026-07)** — `entifix-ts-core`, `-business`, `-rest-client`,
> `-mongo-client`, and `entifix-react-{controls,integration}` are implemented.
> The `load` and `get` use-cases run end-to-end over both REST and Mongo;
> `save`/`delete` are implemented on the adapters (and the shared serializer) but
> not yet driven by a UI/route. To-one links (`EntityLink`) are resolved on both
> web and backend; to-many (`EntityCollectionLink`) is modeled and deserialized
> but only served as foreign keys so far.

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
  #brand = new EntityLink(ProductBrand);      // relation, pre-initialized

  @accessor() get id() { return this.#id; }  set id(v) { this.#id = v; }
  @accessor() get code() { return this.#code; } set code(v) { this.#code = v; }
  @accessor() get brand() { return this.#brand; } // read-only link accessor
}

extractMetaEntity(Product).key        // → 'product'  (collection / route name)
extractMetaAccessors(Product)         // → [{ name:'id', kind:'getter', ... }, ...]
```

This metadata is what makes an adapter **generic**: given only the constructor,
it derives the collection/endpoint name (`key ?? name`) and the field list
(`alias ?? name`, skipping `hidden`). No entity-specific adapter code is needed.

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
link.reload(resolver)   // fetches + caches the target
```

## 3. Effect makes the use-case agnostic

This is the crux. A use-case never receives a repository or a resolver as an
argument or an import — it **yields a `Context.Tag`**, and Effect tracks that
requirement in the type. `entifix-ts-business` defines the tags
(`EntityRepositoryTag`, `EntityLoadRequestTag`, `EntityIdTag`,
`EntityLinkResolverTag`) and the factories:

```ts
export const loadProductsUCFactory = () =>
  Effect.gen(function* () {
    const repository = yield* EntityRepositoryTag;     // ← required, not imported
    const loadRequest = yield* EntityLoadRequestTag;
    const resolver = yield* EntityLinkResolverTag;

    const page = yield* repository.load<Product>(loadRequest);
    yield* Effect.forEach(page.items, (product) =>
      product.brand.isLoaded ? Effect.void : product.brand.reload(resolver),
      { concurrency: 'unbounded', discard: true });
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
  `Db` and the constructor, so each method's Effect requires *nothing* (`R = never`,
  assignable to the interface). It translates `EntityFiltering`/`EntitySorting`/
  pagination to a Mongo query (`filter-translator`), then reuses the shared
  (de)serializer. `MongoDatabaseLayer` provides the connection as a scoped Layer
  (closed on shutdown); `makeMongoLinkResolver` builds an `EntityLinkResolver`
  from the same adapters.

Errors are always an `EntifixError` subclass — `EntifixConnError` (transport),
`EntifixBuildError` (mapping/deserialization), `EntifixLogicError` (e.g. an
unregistered resolver).

## 5. The React side

`entifix-react-integration` runs a use-case against an adapter context inside a
component: `useDataLoading({ uc, ctx })` executes the Effect and exposes
loading/data/error; `useEntityLinkResolver(configStore, registrations)` builds the
resolver context at the page level. `entifix-react-controls` provides the generic
UI (e.g. `Table`). The page is the composition root; the organism and the
use-case never learn the transport.

---

**Layering note.** `core` cannot import `business` or `shells`. That constraint is
why the resolver is a core interface passed into `reload`, and why the tags live
in `business`. When bundling a service that imports entity *values*, every entity
package must carry a stage-3 `.swcrc` and `tslib` must be externalized — see
`CLAUDE.md` and the project memory `node-service-consuming-entifix-libs`.
