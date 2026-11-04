import { EntityRepositoryTag } from '@entifix/business';
import type { Entity } from '@entifix/core';
import { EntifixQueryProvider } from '@entifix/react-integration';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import {
  ShippingLine,
  ShippingOrder,
  type ShippingStatus,
} from '@r10c/business-ts-shipping-order-management';
import { render, screen, waitFor } from '@testing-library/react';
import { Context } from 'effect';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createClientAdapters } from './adapters/create-client-adapters.js';
import type { FulfilmentAdapters } from './client-types.js';
import { FulfilmentProvider } from './fulfilment-context.js';
import {
  FULFILMENT_CRUDS,
  shippingOrderCrud,
  ShippingOrderListClientPage,
  ShippingOrderSingleViewClientPage,
} from './fulfilment-crud.js';

const real = createClientAdapters();

// The pages read the route through `next/navigation`, which only exists inside
// a running Next app; the slug is the one input a test needs to vary.
let slug = 'new';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ slug }),
}));

const aShipment = (id: string, status: ShippingStatus) =>
  Object.assign(new ShippingOrder(), {
    id,
    orderId: `order-${id}`,
    groupId: 'group-1',
    flowId: 'flow-1',
    paymentMethod: 'cod',
    amountDue: 2500,
    currency: 'GTQ',
    lines: [new ShippingLine('offering-1', 2)],
    status,
  });

let repository: ReturnType<typeof makeInMemoryEntityRepository>;

const adapters = (): FulfilmentAdapters => ({
  shippingOrderRest: Context.make(EntityRepositoryTag, repository),
  metadata: real.metadata,
  shippingOrderUseCases: real.shippingOrderUseCases,
});

const renderPage = (page: ReactElement) =>
  render(
    <EntifixQueryProvider>
      <FulfilmentProvider adapters={adapters()}>{page}</FulfilmentProvider>
    </EntifixQueryProvider>,
  );

beforeEach(() => {
  slug = 'new';
  repository = makeInMemoryEntityRepository([
    aShipment('so-1', 'awaiting-dispatch'),
    aShipment('so-2', 'dispatched'),
  ] as Entity[]);
});

describe('the fulfilment descriptors', () => {
  it('exposes the screen the workspace registry derives its tab from', () => {
    expect(FULFILMENT_CRUDS.map(crud => crud.entityKey)).toEqual([
      'shipping-order',
    ]);
  });

  it('names the screen from the entity’s own decorator', () => {
    expect(shippingOrderCrud.entityLabelKey).toBe(
      'entity:shipping-order.label',
    );
    expect(shippingOrderCrud.basePath).toBe('/fulfilment/shipping-order');
  });
});

describe('the worklist', () => {
  // The preset, not the whole collection: a dispatched shipment is one filter
  // change away, but the list opens on what still has to be handed over.
  it('opens on the shipments awaiting dispatch', async () => {
    renderPage(<ShippingOrderListClientPage />);

    await waitFor(() =>
      expect(screen.getAllByText('order-so-1').length).toBeGreaterThan(0),
    );
    expect(screen.queryByText('order-so-2')).not.toBeInTheDocument();
  });
});

/** A record's value, whether the form shows it as an input or as text. */
const shown = (value: string) =>
  screen.queryAllByDisplayValue(value).length +
  screen.queryAllByText(value).length;

describe('the single view', () => {
  it('opens a shipment by its slug, with its lines as a grid of their own', async () => {
    slug = 'so-2';

    renderPage(<ShippingOrderSingleViewClientPage />);

    await waitFor(() => expect(shown('order-so-2')).toBeGreaterThan(0));
    expect(
      screen.getAllByRole('table', { name: 'Líneas' }).length,
    ).toBeGreaterThan(0);
  });

  it('hides the store’s id and the flow that opened the shipment', async () => {
    slug = 'so-1';

    renderPage(<ShippingOrderSingleViewClientPage />);

    await waitFor(() => expect(shown('order-so-1')).toBeGreaterThan(0));
    expect(screen.queryByLabelText('ID')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Flujo')).not.toBeInTheDocument();
  });
});
