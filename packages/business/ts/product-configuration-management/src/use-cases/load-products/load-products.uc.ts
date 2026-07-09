import {
  EntityLinkResolverTag,
  EntityLoadRequestTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import { EntityLoadRequest } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import { Product } from '../../entities/product/product.entity';

/**
 * Loads a page of {@link Product} and ensures each product's relations are
 * materialized.
 *
 * The base repository deserializes whatever the raw payload carried per link:
 * an embedded object is already an instance (`isLoaded`), while a foreign key
 * arrives as an id only. For the latter this use-case follows the link through
 * the {@link EntityLinkResolverTag}, so the returned page always has resolved
 * `brand` and `category` regardless of how the source represented them.
 *
 * Only the repository, load request and resolver are yielded from context — the
 * use-case never references a framework or a concrete adapter, so it runs
 * unchanged over REST on the web or Mongo on the backend.
 */
export function loadProductsUCFactory() {
  return Effect.gen(function* () {
    const repository = yield* EntityRepositoryTag;
    const loadRequest = yield* EntityLoadRequestTag;
    const resolver = yield* EntityLinkResolverTag;

    const typedLoadRequest =
      loadRequest as unknown as EntityLoadRequest<Product>;

    const page = yield* repository.load<Product>(typedLoadRequest);

    yield* Effect.forEach(
      page.items,
      product =>
        Effect.all(
          [
            product.brand.isLoaded
              ? Effect.void
              : product.brand.reload(resolver),
            product.category.isLoaded
              ? Effect.void
              : product.category.reload(resolver),
          ],
          { concurrency: 'unbounded', discard: true }
        ),
      { concurrency: 'unbounded', discard: true }
    );

    return page;
  });
}
