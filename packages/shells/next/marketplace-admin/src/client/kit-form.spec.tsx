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
import { componentsFor, componentsOf, KIT_FORM, KitForm } from './kit-form.js';
import { MarketplaceAdminAdaptersProvider } from './marketplace-admin-context/marketplace-admin-context.js';

const piece = (id: string, name: string, overrides = {}) =>
  Object.assign(new ProductOffering(name, 'spec-1'), { id, ...overrides });

const kase = piece('case', 'Funda');
const film = piece('film', 'Protector');
const cable = piece('cable', 'Cable', { saleUnit: 'M' });
const bundle = piece('bundle', 'Otro kit', { kitSize: 1 });
const kit = (overrides = {}) => piece('kit', 'Kit', overrides);

const adapters = (): MarketplaceAdminAdapters => ({
  ...createClientAdapters(),
  productOfferingRest: Context.make(
    EntityRepositoryTag,
    makeInMemoryEntityRepository([
      kase,
      film,
      cable,
      bundle,
      kit(),
    ] as Entity[]),
  ),
});

const renderForm = (record: ProductOffering, submit = vi.fn()) => {
  render(
    <EntifixQueryProvider>
      <MarketplaceAdminAdaptersProvider adapters={adapters()}>
        <KitForm record={record} formId="kit-form" submit={submit} />
        <button type="submit" form="kit-form">
          Send
        </button>
      </MarketplaceAdminAdaptersProvider>
    </EntifixQueryProvider>,
  );
  return submit;
};

describe('KitForm', () => {
  it('is the form set-kit names', () => {
    expect(KIT_FORM).toBe('kit');
  });

  it('offers every other offering sold by the unit that is no kit', () => {
    expect(
      componentsFor(kit(), [kase, film, cable, bundle, kit()]).map(
        one => one.id,
      ),
    ).toEqual(['case', 'film']);
  });

  it('sends the rows that picked a product, as typed', () => {
    expect(
      componentsOf([
        { key: 0, offeringId: 'case', quantity: '2' },
        { key: 1, offeringId: '', quantity: '1' },
      ]),
    ).toEqual([{ offeringId: 'case', quantity: 2 }]);
  });

  it('adds a product to the kit, with the revision it read', async () => {
    const submit = renderForm(kit({ revision: 3 }));

    await userEvent.click(
      await screen.findByRole('button', { name: 'Agregar un producto' }),
    );
    await userEvent.selectOptions(screen.getByLabelText('Producto'), 'film');
    const quantity = screen.getByLabelText('Cantidad');
    await userEvent.clear(quantity);
    await userEvent.type(quantity, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(submit).toHaveBeenCalledWith({
      components: [{ offeringId: 'film', quantity: 2 }],
      revision: 3,
    });
    expect(screen.queryByTestId('kit-not-counted')).toBeNull();
  });

  it('changes one row of several, leaving the others as they were', async () => {
    const submit = renderForm(
      kit({
        kitComponents: [
          { offeringId: 'case', quantity: 1 },
          { offeringId: 'film', quantity: 1 },
        ],
        kitSize: 2,
      }),
    );

    const [, second] = await screen.findAllByLabelText('Cantidad');
    await userEvent.clear(second!);
    await userEvent.type(second!, '3');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(submit).toHaveBeenCalledWith({
      components: [
        { offeringId: 'case', quantity: 1 },
        { offeringId: 'film', quantity: 3 },
      ],
    });
  });

  it('starts from the kit’s components, and a removed row leaves it plain', async () => {
    const submit = renderForm(
      kit({ kitComponents: [{ offeringId: 'case', quantity: 1 }], kitSize: 1 }),
    );

    expect(await screen.findByLabelText('Producto')).toHaveValue('case');
    await userEvent.click(
      screen.getByRole('button', { name: 'Quitar producto 1' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(submit).toHaveBeenCalledWith({ components: [] });
  });

  it('sends nothing while the offerings are still loading', async () => {
    const submit = renderForm(kit());

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(screen.getByText('Cargando tus ofertas…')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    await screen.findByRole('button', { name: 'Agregar un producto' });
  });

  it('says a kit is sold by the unit when this one is not', async () => {
    renderForm(kit({ saleUnit: 'M' }));

    expect(await screen.findByTestId('kit-not-counted')).toBeInTheDocument();
  });

  it('stops offering another row at the most a kit holds', async () => {
    renderForm(
      kit({
        kitComponents: Array.from({ length: 10 }, (_, at) => ({
          offeringId: `c${String(at)}`,
          quantity: 1,
        })),
      }),
    );

    await screen.findAllByLabelText('Producto');
    expect(
      screen.queryByRole('button', { name: 'Agregar un producto' }),
    ).toBeNull();
  });
});
