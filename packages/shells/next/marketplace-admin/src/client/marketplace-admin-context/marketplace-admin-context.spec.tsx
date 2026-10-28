import { EntityRepositoryTag } from '@entifix/business';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { renderHook } from '@testing-library/react';
import { Context } from 'effect';
import type { PropsWithChildren } from 'react';
import { describe, expect, it } from 'vitest';

import { createClientAdapters } from '../adapters/create-client-adapters.js';
import type { MarketplaceAdminAdapters } from '../client-types.js';
import {
  MarketplaceAdminAdaptersProvider,
  useMarketplaceAdminAdapters,
} from './marketplace-admin-context.js';

/** The transports the shell really composes, so metadata reads behave as in production. */
const real = createClientAdapters();

const repository = () =>
  Context.make(EntityRepositoryTag, makeInMemoryEntityRepository([]));

const adapters: MarketplaceAdminAdapters = {
  productRest: repository(),
  productBrandRest: repository(),
  productCategoryRest: repository(),
  productOfferingRest: repository(),
  productOfferingPriceRest: repository(),
  referenceMetadata: real.referenceMetadata,
  catalogMetadata: real.catalogMetadata,
  transactionStatus: real.transactionStatus,
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
