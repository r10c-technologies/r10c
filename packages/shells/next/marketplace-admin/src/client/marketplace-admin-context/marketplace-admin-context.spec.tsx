import { EntityRepositoryTag } from '@entifix/business';
import { type EntityWriter, settled } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { renderHook } from '@testing-library/react';
import { Context, Effect } from 'effect';
import type { PropsWithChildren } from 'react';
import { describe, expect, it } from 'vitest';

import { createClientAdapters } from '../adapters/create-client-adapters.js';
import type { MarketplaceAdminAdapters } from '../client-types.js';
import {
  MarketplaceAdminAdaptersProvider,
  useMarketplaceAdminAdapters,
} from './marketplace-admin-context.js';

/**
 * A writer that settles every write through the spec's own in-memory
 * repository, as a write that commits in one unit does (ADR 0073).
 */
const settledWriter = (
  context: Context.Context<EntityRepositoryTag>,
): EntityWriter => {
  const repository = Context.get(context, EntityRepositoryTag);
  return {
    save: entity => Effect.map(repository.save(entity), settled),
    delete: entityOrId =>
      Effect.as(repository.delete(entityOrId), settled(undefined)),
  };
};

/** The transports the shell really composes, so metadata reads behave as in production. */
const real = createClientAdapters();

const repository = () =>
  Context.make(EntityRepositoryTag, makeInMemoryEntityRepository([]));

const adapters: MarketplaceAdminAdapters = {
  productRest: repository(),
  productWriter: settledWriter(repository()),
  productBrandRest: repository(),
  productBrandWriter: settledWriter(repository()),
  productCategoryRest: repository(),
  productCategoryWriter: settledWriter(repository()),
  productOfferingRest: repository(),
  productOfferingWriter: settledWriter(repository()),
  productOfferingPriceRest: repository(),
  productOfferingPriceWriter: settledWriter(repository()),
  referenceMetadata: real.referenceMetadata,
  catalogMetadata: real.catalogMetadata,
  productBrandUseCases: real.productBrandUseCases,
  productCategoryUseCases: real.productCategoryUseCases,
  productOfferingUseCases: real.productOfferingUseCases,
};

describe('the marketplace-admin adapters context', () => {
  it('publishes the adapters to its descendants', () => {
    const wrapper = ({ children }: PropsWithChildren) => (
      <MarketplaceAdminAdaptersProvider adapters={adapters}>
        {children}
      </MarketplaceAdminAdaptersProvider>
    );

    const { result } = renderHook(() => useMarketplaceAdminAdapters(), {
      wrapper,
    });

    expect(result.current).toBe(adapters);
  });

  // Without the provider every adapter would be `undefined` and the failure
  // would surface much later, inside a use-case, as something unrelated.
  it('fails loudly outside the provider', () => {
    expect(() => renderHook(() => useMarketplaceAdminAdapters())).toThrow(
      Error,
    );
  });
});
