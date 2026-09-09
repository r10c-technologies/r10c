import { OrderItem, ProductOrder } from '@r10c/business-ts-order-management';
import { EntifixQueryProvider } from '@r10c/entifix-react-integration';
import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import type { Entity } from '@r10c/entifix-ts-core';
import {
  makeInMemoryEntityRepository,
  makeStubConfigurationClient,
} from '@r10c/entifix-ts-testing-unit';
import { render, screen, waitFor } from '@testing-library/react';
import { Context } from 'effect';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrderAdapters } from './client-types.js';
import { OrderProvider } from './order-context.js';
import {
  ORDER_CRUDS,
  productOrderCrud,
  ProductOrderListClientPage,
  ProductOrderSingleViewClientPage,
} from './order-crud.js';

// These pages are `makeEntityCrud` output, so what is worth asserting is that
// the generator was handed the right facts — the adapter the screen reads, the
// route it lives at, and the metadata source that decides its affordances.
//
// The pages read the route through `next/navigation`, which only exists inside
// a running Next app; the slug is the one input a test needs to vary.
let slug = 'new';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ slug }),
}));

const makeOrder = () => {
  const order = new ProductOrder('party-user-2');
  order.id = 'product-order-1';
  order.status = 'pending';
  order.items = [
    new OrderItem('product-offering-1', 'demo-organization', 2, 1999, 'GTQ'),
  ];
  return order;
};

let repository: ReturnType<typeof makeInMemoryEntityRepository>;

const adapters = (): OrderAdapters => ({
  productOrderRest: Context.make(EntityRepositoryTag, repository),
  configurationStore: Context.make(
    ConfigurationRepositoryTag,
    makeStubConfigurationClient(),
  ),
});

const renderPage = (page: ReactElement) =>
  render(
    <EntifixQueryProvider>
      <OrderProvider adapters={adapters()}>{page}</OrderProvider>
    </EntifixQueryProvider>,
  );

beforeEach(() => {
  slug = 'new';
  repository = makeInMemoryEntityRepository([makeOrder()] as Entity[]);
});

describe('the order descriptors', () => {
  it('exposes the screen the workspace registry derives its tab from', () => {
    expect(ORDER_CRUDS.map(crud => crud.entityKey)).toEqual(['product-order']);
  });

  it('names the screen from the entity’s own decorator', () => {
    // The tab caption and the table heading come from the same place, so one
    // cannot drift from the other.
    expect(productOrderCrud.entityLabelKey).toBe('entity:product-order.label');
    expect(productOrderCrud.entityPluralKey).toBe(
      'entity:product-order.plural',
    );
  });

  it('generates the screen at the route its surface declares', () => {
    expect(productOrderCrud.basePath).toBe('/order/product-order');
  });
});

describe('the listing page', () => {
  it('lists orders from the adapters it was given', async () => {
    renderPage(<ProductOrderListClientPage />);

    await waitFor(() =>
      expect(screen.getAllByText('party-user-2').length).toBeGreaterThan(0),
    );
  });

  it('renders the status column from the entity’s own metadata', async () => {
    // Derived from `@accessor()`, which is what makes the screen a generated one
    // rather than a written one.
    //
    // Asserted on the **column header** rather than the text: the label also
    // appears in the sort and column-visibility controls, so a bare text query
    // matches three elements.
    renderPage(<ProductOrderListClientPage />);

    await waitFor(() =>
      expect(
        screen.getByRole('columnheader', { name: 'Estado' }),
      ).toBeInTheDocument(),
    );
  });
});

describe('the single view', () => {
  it('opens an order by its slug', async () => {
    slug = 'product-order-1';

    renderPage(<ProductOrderSingleViewClientPage />);

    await waitFor(() =>
      expect(
        screen.getAllByDisplayValue('party-user-2').length +
          screen.queryAllByText('party-user-2').length,
      ).toBeGreaterThan(0),
    );
  });

  /**
   * ⚠️ `items` is deliberately **not** hidden. `hidden` drops a member from
   * serialization *and* deserialization, so hiding the lines would mean an order
   * rendered without the only thing on it that says what was bought. They are
   * read-only because the served descriptor withholds Save — which is the right
   * mechanism: a receipt is not a form.
   */
  it('renders the collection the order owns as its own section', async () => {
    slug = 'product-order-1';

    renderPage(<ProductOrderSingleViewClientPage />);

    // The `composition` member gets a detail grid of its own, labelled from the
    // entity's `entity:product-order.fields.items` key — which is the mechanism
    // saying the lines belong to this record rather than being linked from it.
    await waitFor(() =>
      expect(
        screen.getAllByRole('table', { name: 'Líneas' }).length,
      ).toBeGreaterThan(0),
    );
  });

  it('hides the server-owned id', async () => {
    slug = 'new';

    renderPage(<ProductOrderSingleViewClientPage />);

    // `place-order.ts` mints it, so a field asking for one would be asking for a
    // value the service overwrites.
    await waitFor(() =>
      expect(screen.queryByLabelText('ID')).not.toBeInTheDocument(),
    );
  });
});
