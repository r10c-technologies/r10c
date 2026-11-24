import { EntityRepositoryTag } from '@entifix/business';
import type { Entity } from '@entifix/core';
import { EntifixQueryProvider } from '@entifix/react-integration';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { ProductOffering } from '@r10c/business-ts-product-configuration-management';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Context } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { createClientAdapters } from './adapters/create-client-adapters.js';
import type { MarketplaceAdminAdapters } from './client-types.js';
import { MarketplaceAdminAdaptersProvider } from './marketplace-admin-context/marketplace-admin-context.js';
import {
  basesFor,
  STOCK_SOURCE_FORM,
  StockSourceForm,
} from './stock-source-form.js';

/** A cable stocked in metres, sold by the half metre. */
const cable = Object.assign(new ProductOffering('Cable', 'spec-1'), {
  id: 'cable',
  saleUnit: 'M',
  quantityStep: 500,
  quantityMinimum: 1000,
});

/** A roll of it, sold by the piece. */
const roll = (overrides: Partial<ProductOffering> = {}) =>
  Object.assign(new ProductOffering('Rollo 100 m', 'spec-1'), {
    id: 'roll',
    ...overrides,
  });

/** Another presentation, which nothing may draw on. */
const pack = Object.assign(new ProductOffering('Paquete', 'spec-1'), {
  id: 'pack',
  stockOfferingId: 'cable',
  stockFactor: 2000,
});

const adapters = (): MarketplaceAdminAdapters => ({
  ...createClientAdapters(),
  productOfferingRest: Context.make(
    EntityRepositoryTag,
    makeInMemoryEntityRepository([cable, roll(), pack] as Entity[]),
  ),
});

const renderForm = (record: ProductOffering, submit = vi.fn()) => {
  render(
    <EntifixQueryProvider>
      <MarketplaceAdminAdaptersProvider adapters={adapters()}>
        <StockSourceForm record={record} formId="stock-form" submit={submit} />
        <button type="submit" form="stock-form">
          Send
        </button>
      </MarketplaceAdminAdaptersProvider>
    </EntifixQueryProvider>,
  );
  return submit;
};

describe('StockSourceForm', () => {
  it('is the form draw-on-stock names', () => {
    expect(STOCK_SOURCE_FORM).toBe('stock-source');
  });

  it('offers every other offering that is not a presentation', () => {
    expect(basesFor(roll(), [cable, roll(), pack]).map(one => one.id)).toEqual([
      'cable',
    ]);
  });

  it('draws on the picked base, the factor typed in the base’s unit', async () => {
    const submit = renderForm(roll({ revision: 4 }));

    await userEvent.selectOptions(
      await screen.findByLabelText('Toma su inventario de'),
      'cable',
    );
    const factor = screen.getByLabelText('Cada una toma');
    await userEvent.clear(factor);
    await userEvent.type(factor, '100');
    await userEvent.tab();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(submit).toHaveBeenCalledWith({
      stockOfferingId: 'cable',
      stockFactor: 100_000,
      revision: 4,
    });
    expect(screen.queryByTestId('stock-source-not-counted')).toBeNull();
  });

  it('stops drawing when no base is picked', async () => {
    const submit = renderForm(
      roll({ stockOfferingId: 'cable', stockFactor: 100_000 }),
    );

    await userEvent.selectOptions(
      await screen.findByLabelText('Toma su inventario de'),
      '',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(submit).toHaveBeenCalledWith({});
  });

  it('sends nothing while the offerings are still loading', async () => {
    const submit = renderForm(roll());

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(screen.getByText('Cargando tus ofertas…')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    await screen.findByLabelText('Toma su inventario de');
  });

  it('says a presentation is sold by the unit when this one is not', async () => {
    renderForm(roll({ saleUnit: 'M' }));

    expect(
      await screen.findByTestId('stock-source-not-counted'),
    ).toBeInTheDocument();
  });
});
