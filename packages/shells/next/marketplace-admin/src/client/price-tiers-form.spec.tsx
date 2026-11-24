import { EntityRepositoryTag } from '@entifix/business';
import type { Entity } from '@entifix/core';
import { EntifixQueryProvider } from '@entifix/react-integration';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import {
  ProductOffering,
  ProductOfferingPrice,
} from '@r10c/business-ts-product-configuration-management';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Context } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { createClientAdapters } from './adapters/create-client-adapters.js';
import type { MarketplaceAdminAdapters } from './client-types.js';
import { MarketplaceAdminAdaptersProvider } from './marketplace-admin-context/marketplace-admin-context.js';
import { PRICE_TIERS_FORM, PriceTiersForm } from './price-tiers-form.js';

/** A cable sold by the half metre from one metre. */
const cable = Object.assign(new ProductOffering('Cable', 'spec-1'), {
  id: 'o-1',
  saleUnit: 'M',
  quantityStep: 500,
  quantityMinimum: 1000,
});

const adapters = (): MarketplaceAdminAdapters => ({
  ...createClientAdapters(),
  productOfferingRest: Context.make(
    EntityRepositoryTag,
    makeInMemoryEntityRepository([cable] as Entity[]),
  ),
});

const price = (tiers?: { from: number; amount: number }[], revision?: number) =>
  Object.assign(new ProductOfferingPrice('o-1', 1250, 'GTQ'), {
    id: 'p-1',
    ...(tiers === undefined ? {} : { tiers }),
    ...(revision === undefined ? {} : { revision }),
  });

const renderForm = (record: ProductOfferingPrice, submit = vi.fn()) => {
  render(
    <EntifixQueryProvider>
      <MarketplaceAdminAdaptersProvider adapters={adapters()}>
        <PriceTiersForm record={record} formId="tiers-form" submit={submit} />
        <button type="submit" form="tiers-form">
          Send
        </button>
      </MarketplaceAdminAdaptersProvider>
    </EntifixQueryProvider>,
  );
  return submit;
};

describe('PriceTiersForm', () => {
  it('is the form set-price-tiers names', () => {
    expect(PRICE_TIERS_FORM).toBe('price-tiers');
  });

  it('says there are none, then adds a tier one step past the minimum', async () => {
    const submit = renderForm(price(undefined, 2));

    expect(await screen.findByTestId('price-tiers-empty')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Agregar un tramo' }),
    );
    await userEvent.type(screen.getByLabelText('Precio'), '11');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(submit).toHaveBeenCalledWith({
      tiers: [{ from: 1500, amount: 1100 }],
      revision: 2,
    });
  });

  it('starts from the stored tiers, adds after the last, and removes one', async () => {
    const submit = renderForm(
      price([
        { from: 10_000, amount: 1100 },
        { from: 50_000, amount: 950 },
      ]),
    );

    expect(await screen.findAllByTestId('price-tier-row')).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'Tramo 1' })).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Quitar el tramo 1' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Agregar un tramo' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    // An empty amount is sent as no number, for the service to refuse.
    expect(submit).toHaveBeenCalledWith({
      tiers: [
        { from: 50_000, amount: 950 },
        { from: 50_500, amount: Number.NaN },
      ],
    });
  });

  it('edits one tier’s quantity in the offering’s unit, leaving the others', async () => {
    const submit = renderForm(
      price([
        { from: 10_000, amount: 1100 },
        { from: 50_000, amount: 950 },
      ]),
    );

    const [quantity] = await screen.findAllByRole('spinbutton', {
      name: 'Desde',
    });
    if (quantity === undefined) throw new Error('no quantity field');
    await userEvent.clear(quantity);
    await userEvent.type(quantity, '12{Tab}');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(submit).toHaveBeenCalledWith({
      tiers: [
        { from: 12_000, amount: 1100 },
        { from: 50_000, amount: 950 },
      ],
    });
  });

  it('offers no more tiers than a price holds', async () => {
    renderForm(
      price(
        [1, 2, 3, 4, 5].map(step => ({
          from: 1000 + step * 1000,
          amount: 1200 - step,
        })),
      ),
    );

    expect(await screen.findAllByTestId('price-tier-row')).toHaveLength(5);
    expect(
      screen.queryByRole('button', { name: 'Agregar un tramo' }),
    ).not.toBeInTheDocument();
  });

  it('asks for nothing until the offering is read, and submits nothing then', async () => {
    const submit = vi.fn();
    render(
      <EntifixQueryProvider>
        <MarketplaceAdminAdaptersProvider adapters={adapters()}>
          <PriceTiersForm
            record={Object.assign(price(), { offeringId: '' })}
            formId="tiers-form"
            submit={submit}
          />
          <button type="submit" form="tiers-form">
            Send
          </button>
        </MarketplaceAdminAdaptersProvider>
      </EntifixQueryProvider>,
    );

    expect(screen.getByText('Cargando el producto…')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(submit).not.toHaveBeenCalled();
  });
});
