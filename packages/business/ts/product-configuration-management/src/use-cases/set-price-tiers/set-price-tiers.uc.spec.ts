import { EntityRepositoryFactoryTag } from '@entifix/business';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProductOffering } from '../../entities/product-offering/product-offering.entity.js';
import { ProductOfferingPrice } from '../../entities/product-offering-price/product-offering-price.entity.js';
import { OfferingCatalogTag } from '../../ports/offering-catalog.js';
import { makeInMemoryOfferingCatalog } from '../../testing/in-memory-catalog.js';
import { SET_PRICE_TIERS, SetPriceTiersUC } from './set-price-tiers.uc.js';

/** A cable sold by the half metre from a metre, priced at Q12.50 the metre. */
const world = (revision?: number) => {
  const offering = Object.assign(new ProductOffering('Cable', 'spec-1'), {
    id: 'o-1',
    saleUnit: 'M',
    quantityStep: 500,
    quantityMinimum: 1000,
  });
  const price = Object.assign(new ProductOfferingPrice('o-1', 1250, 'GTQ'), {
    id: 'p-1',
    revision,
  });
  const offerings = makeInMemoryEntityRepository([offering]);
  const prices = makeInMemoryEntityRepository([price]);
  const layer = Layer.mergeAll(
    Layer.succeed(EntityRepositoryFactoryTag, {
      for: entity =>
        Effect.succeed(
          (entity as unknown) === ProductOffering ? offerings : prices,
        ),
    }),
    Layer.succeed(
      OfferingCatalogTag,
      makeInMemoryOfferingCatalog({}, { acme: [{ id: 'p-1', revision }] }),
    ),
  );
  return <A, E>(
    effect: Effect.Effect<
      A,
      E,
      EntityRepositoryFactoryTag | OfferingCatalogTag
    >,
  ) => Effect.runPromise(Effect.provide(effect, layer) as Effect.Effect<A, E>);
};

const setTiers = (
  tiers: readonly { from: number; amount: number }[],
  revision?: number,
) =>
  SetPriceTiersUC.run({
    organizationId: 'acme',
    id: 'p-1',
    payload: { tiers, revision },
  });

describe('SetPriceTiersUC', () => {
  it('derives its permission from the price', () => {
    expect(SET_PRICE_TIERS).toBe(
      'product-configuration-management:product-offering-price:set-price-tiers',
    );
  });

  it('writes tiers that fit the offering’s rule, as plain values, and answers the new revision', async () => {
    const run = world(3);

    const set = await run(
      setTiers(
        [
          { from: 10_000, amount: 1100 },
          { from: 50_000, amount: 950 },
        ],
        3,
      ),
    );

    expect(set.tiers).toEqual([
      { from: 10_000, amount: 1100 },
      { from: 50_000, amount: 950 },
    ]);
    expect(set.revision).toBe(4);
  });

  it('removes them with an empty list, leaving the member absent', async () => {
    const run = world(1);

    expect((await run(setTiers([]))).tiers).toBeUndefined();
  });

  it('writes a seeded price, which has no revision, at revision 1', async () => {
    const run = world();

    expect(
      (await run(setTiers([{ from: 10_000, amount: 1100 }]))).revision,
    ).toBe(1);
  });

  it('refuses a tier off the offering’s step, and writes nothing', async () => {
    const run = world(1);

    const error = await run(
      Effect.flip(setTiers([{ from: 10_200, amount: 1100 }])),
    );
    const after = await run(setTiers([], 1));

    expect(error).toMatchObject({
      code: 'priceTiersInvalid',
      index: 0,
      problem: 'quantity',
    });
    expect(after.revision).toBe(2);
  });

  it('answers a write that lost to another as changed', async () => {
    const run = world(3);

    const error = await run(
      Effect.flip(setTiers([{ from: 10_000, amount: 1100 }], 2)),
    );

    expect(error).toMatchObject({ code: 'priceChanged', id: 'p-1' });
    expect(error.message).toContain('reload it');
  });
});
