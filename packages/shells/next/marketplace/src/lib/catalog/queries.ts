import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import {
  ConfigurationRepositoryTag,
  EntityLoadRequestTag,
  EntityRepositoryTag,
  loadUCFactory,
} from '@r10c/entifix-ts-business';
import type {
  Entity,
  EntityConstructor,
  EntityLoadRequest,
  EntityPage,
} from '@r10c/entifix-ts-core';
import {
  buildEntityRestAdapterDelete,
  buildEntityRestAdapterGet,
  buildEntityRestAdapterLoad,
  buildEntityRestAdapterSave,
  type BuildEntityRestOptions,
  ConfigurationClientRestClient,
} from '@r10c/entifix-ts-rest-client';
import {
  configApiUrl,
  SERVICE_TOKEN_HEADER,
  serviceToken,
} from '@r10c/shells-next-common/server';
import { Cause, Context, Effect } from 'effect';

/**
 * The storefront's read side, against marketplace-service.
 *
 * Every function here is the server mirror of what marketplace-admin does in a
 * client page: build a `Context` from adapters, hand it to the *same* generic
 * use-case, run it. What differs is only where it runs and what it reads —
 * these are React server components, and what they read is the **projection**
 * (`published-catalog`) plus the platform-plane browse vocabulary
 * (`catalog-reference`). Both are marketplace-service's, so there is one
 * backend and one configuration key.
 *
 * ⚠️ **No proxy, and none is wanted.** `rewriteServiceDomains` exists so a real
 * backend address never reaches a browser; nothing here reaches a browser, so
 * the storefront talks to the service base URL directly. Reads there are
 * unauthenticated by design — the storefront must never hold a session to show
 * a catalog.
 */

/**
 * The one backend, composed per entity from its `@entity({ key })`.
 *
 * The same shape marketplace-admin's `create-client-adapters.ts` uses; the
 * difference is the value behind the key, which config-service supplies per
 * app.
 */
const MARKETPLACE_SERVICE: BuildEntityRestOptions = {
  uriConfig: {
    key: 'marketplace-service-domain.[entity]',
    group: 'uri',
    extractionMode: 'compose',
  },
};

/**
 * Where the URL for the key above comes from.
 *
 * ⚠️ Read **directly from config-service**, with the shared fleet token, rather
 * than from this app's own `/api/config`: a relative URL has no origin to
 * resolve against under Node, and an app fetching its own route while
 * prerendering itself is a request that cannot be served. That endpoint is
 * gated because it serves real connection strings, so the header is not
 * optional — this is the same lookup `createConfigRoute` and the readiness
 * probe already make, minus the browser they exist to protect.
 *
 * One instance, so the lookup is memoized for the life of the process. A
 * changed URI therefore needs a restart, exactly as it does in the browser.
 */
const configuration = Context.make(
  ConfigurationRepositoryTag,
  new ConfigurationClientRestClient({
    url: `${configApiUrl()}/api/config/marketplace-app`,
    headers: { [SERVICE_TOKEN_HEADER]: serviceToken() },
  }),
);

/**
 * The full adapter set for one entity.
 *
 * `save` and `delete` are built even though the storefront never calls them:
 * `EntityRepositoryTag` is one tag with four members, and stubbing two of them
 * to a failure would be a second contract to keep in step with the real one for
 * no gain. Nothing here can write anyway — `published-catalog` is a projection
 * with a single writer, and marketplace-service registers no POST for it.
 */
const repositoryFor = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
) =>
  Context.make(EntityRepositoryTag, {
    get: buildEntityRestAdapterGet(entityConstructor, MARKETPLACE_SERVICE),
    load: buildEntityRestAdapterLoad(entityConstructor, MARKETPLACE_SERVICE),
    save: buildEntityRestAdapterSave(entityConstructor, MARKETPLACE_SERVICE),
    delete: buildEntityRestAdapterDelete(
      entityConstructor,
      MARKETPLACE_SERVICE,
    ),
  });

/**
 * `request` is echoed back as the page's own, which is what a real adapter
 * does. The cast is the same one every call site in this file makes: an
 * `EntityLoadRequest` is parameterized by the entity it filters, and a filter
 * is a member *name*, so the two instantiations never overlap structurally even
 * though the value is identical.
 */
const emptyPage = <TEntity extends Entity>(
  request: EntityLoadRequest<Entity>,
): EntityPage<TEntity> => ({
  items: [],
  total: 0,
  request: request as never,
});

/**
 * Runs the generic load use-case, and **never rejects**.
 *
 * Two reasons, and the second is the one that matters. `next build` prerenders
 * the home page per locale, and a build machine has no fleet — a throw here
 * would make the build depend on a running backend. And a storefront that
 * answers `500` because one backend blinked is worse than one that renders its
 * own "nothing here yet" copy over an intact page.
 *
 * ⚠️ The cost is real and is accepted rather than hidden: **an empty catalog
 * and a broken backend render identically.** The log is the only thing that
 * tells them apart, which is why this must not spread to anything that writes.
 * `catchAllCause` rather than `catchAll` so a defect is caught too — a defect
 * escaping into a prerender fails the build just as loudly as a failure.
 */
const loadPage = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  request: EntityLoadRequest<Entity>,
): Promise<EntityPage<TEntity>> =>
  Effect.runPromise(
    loadUCFactory<TEntity>().pipe(
      Effect.provide(
        Context.merge(
          Context.merge(configuration, repositoryFor(entityConstructor)),
          Context.make(EntityLoadRequestTag, request),
        ),
      ),
      Effect.catchAllCause(cause =>
        Effect.sync(() => {
          console.error(
            `The storefront could not read ${entityConstructor.name}: ${Cause.pretty(cause)}`,
          );
          return emptyPage<TEntity>(request);
        }),
      ),
    ) as Effect.Effect<EntityPage<TEntity>>,
  );

export interface OfferingQuery {
  /** A category `code`, as it appears in the URL. */
  readonly category?: string;
  /** Free text, matched against the offering name. */
  readonly search?: string;
  readonly sort?: 'name' | 'code';
  readonly direction?: 'asc' | 'desc';
  readonly page?: number;
  readonly pageSize?: number;
}

/**
 * How many brands or categories one read takes.
 *
 * The browse vocabulary is operator-authored and platform-wide — a marketplace
 * has to *merge* it, which is why it is not per vendor — so it is bounded by
 * construction and small. If that ever stops being true the fix is a lookup
 * filtered by id, which needs `id` to become `filterable` on both entities;
 * paging silently here instead would make a brand vanish from the storefront
 * with nothing failing.
 */
const VOCABULARY_PAGE_SIZE = 200;

/** Every category, for the nav strip and the category routes. */
export function loadCategories(): Promise<EntityPage<ProductCategory>> {
  return loadPage(ProductCategory, {
    sorting: [{ 0: { property: 'name', type: 'asc' } }] as never,
    pageSize: VOCABULARY_PAGE_SIZE,
  });
}

/** Every brand, so a grid can name each offering's without a request per card. */
export function loadBrands(): Promise<EntityPage<ProductBrand>> {
  return loadPage(ProductBrand, {
    sorting: [{ 0: { property: 'name', type: 'asc' } }] as never,
    pageSize: VOCABULARY_PAGE_SIZE,
  });
}

/**
 * The category a URL slug names.
 *
 * `code` is `filterable` — a scalar member inherits both flags, which is also
 * the server-side RSQL allowlist — so this is one filtered read rather than the
 * whole vocabulary scanned in the page.
 */
export async function getCategoryByCode(
  code: string,
): Promise<ProductCategory | undefined> {
  const page = await loadPage(ProductCategory, {
    filtering: [{ property: 'code', operator: 'eq', value: code }] as never,
    pageSize: 1,
  });
  return page.items[0];
}

/**
 * A brand by id, or `undefined` when an offering names one that no longer
 * exists.
 *
 * ⚠️ Resolved out of the loaded vocabulary rather than with `repository.get`:
 * `id` is the one member that is neither `sortable` nor `filterable` by
 * default, so it cannot be queried — and `get` answers an absent row with
 * `EntifixConnError`, the same class a driver failure raises, so a dangling
 * reference and a Mongo outage would be one code path. `brandId` points into
 * another slice's store and nothing enforces it, so a miss is a display gap the
 * caller renders a fallback for.
 */
export async function getBrand(
  id: string | undefined,
): Promise<ProductBrand | undefined> {
  if (id === undefined) return undefined;
  const page = await loadBrands();
  return page.items.find(brand => String(brand.id) === id);
}

/** A category by id. Same shape and same caveats as {@link getBrand}. */
export async function getCategory(
  id: string | undefined,
): Promise<ProductCategory | undefined> {
  if (id === undefined) return undefined;
  const page = await loadCategories();
  return page.items.find(category => String(category.id) === id);
}

/**
 * The published catalog, filtered the way the URL asks.
 *
 * The URL carries a category's `code` and the projection stores a
 * `categoryId`, so the slug is resolved first — an unknown one answers an empty
 * page without ever querying the catalog, rather than filtering on
 * `undefined` and matching everything.
 */
export async function loadOfferings(
  query: OfferingQuery = {},
): Promise<EntityPage<PublishedOffering>> {
  const request: EntityLoadRequest<Entity> = {
    page: query.page,
    pageSize: query.pageSize,
    sorting: query.sort
      ? ([
          { 0: { property: query.sort, type: query.direction ?? 'asc' } },
        ] as never)
      : undefined,
  };

  let categoryId: string | undefined;
  if (query.category !== undefined) {
    const category = await getCategoryByCode(query.category);
    if (category === undefined) return emptyPage(request);
    categoryId = String(category.id);
  }

  const filtering = [
    ...(categoryId !== undefined
      ? [{ property: 'categoryId', operator: 'eq' as const, value: categoryId }]
      : []),
    ...(query.search
      ? [{ property: 'name', operator: 'like' as const, value: query.search }]
      : []),
  ];

  return loadPage(PublishedOffering, {
    ...request,
    filtering: filtering.length > 0 ? (filtering as never) : undefined,
  });
}

/**
 * One published offering by the id the URL slug carries.
 *
 * ⚠️ **`load` with a filter, never `get`** (ADR 0049). `PublishedOffering.id`
 * *is* the offering id — the projector assigns it — so a `get` would resolve;
 * it would also turn a 404 page and a datastore outage into the same
 * `EntifixConnError`, which is how every visitor gets told the product does not
 * exist during an incident. `offeringId` is declared `filterable` for exactly
 * this read.
 */
export async function getOffering(
  offeringId: string,
): Promise<PublishedOffering | undefined> {
  const page = await loadPage(PublishedOffering, {
    filtering: [
      { property: 'offeringId', operator: 'eq', value: offeringId },
    ] as never,
    pageSize: 1,
  });
  return page.items[0];
}
