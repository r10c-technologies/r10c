import {
  Reservation,
  StockItem,
  StockMovement,
} from '@r10c/business-ts-stock-management';
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

import type { StockAdapters } from './client-types.js';
import { StockProvider } from './stock-context.js';
import {
  reservationCrud,
  ReservationListClientPage,
  STOCK_CRUDS,
  stockItemCrud,
  StockItemListClientPage,
  StockItemSingleViewClientPage,
  stockMovementCrud,
  StockMovementListClientPage,
  StockMovementSingleViewClientPage,
} from './stock-crud.js';

// These pages are `makeEntityCrud` output, so what is worth asserting is that
// the generator was handed the right facts — the adapter each screen reads, the
// route it lives at, and the metadata source that decides its affordances.
//
// The pages read the route through `next/navigation`, which only exists inside
// a running Next app; the slug is the one input a test needs to vary.
let slug = 'new';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ slug }),
}));

const makeItem = () => {
  const item = new StockItem('product-offering-1');
  item.id = 'stock-item-1';
  item.onHand = 10;
  item.reserved = 0;
  return item;
};

const makeMovement = () => {
  const movement = new StockMovement('product-offering-1', 10, 'receipt');
  movement.id = 'stock-movement-1';
  return movement;
};

const makeReservation = () => {
  const reservation = new Reservation('product-offering-1', 2);
  reservation.id = 'reservation-1';
  return reservation;
};

let repositories: {
  item: ReturnType<typeof makeInMemoryEntityRepository>;
  movement: ReturnType<typeof makeInMemoryEntityRepository>;
  reservation: ReturnType<typeof makeInMemoryEntityRepository>;
};

const adapters = (): StockAdapters => ({
  stockItemRest: Context.make(EntityRepositoryTag, repositories.item),
  stockMovementRest: Context.make(EntityRepositoryTag, repositories.movement),
  reservationRest: Context.make(EntityRepositoryTag, repositories.reservation),
  configurationStore: Context.make(
    ConfigurationRepositoryTag,
    makeStubConfigurationClient(),
  ),
});

const renderPage = (page: ReactElement) =>
  render(
    <EntifixQueryProvider>
      <StockProvider adapters={adapters()}>{page}</StockProvider>
    </EntifixQueryProvider>,
  );

beforeEach(() => {
  slug = 'new';
  repositories = {
    item: makeInMemoryEntityRepository([makeItem()] as Entity[]),
    movement: makeInMemoryEntityRepository([makeMovement()] as Entity[]),
    reservation: makeInMemoryEntityRepository([makeReservation()] as Entity[]),
  };
});

describe('the stock descriptors', () => {
  it('exposes the three screens the workspace registry derives its tabs from', () => {
    expect(STOCK_CRUDS.map(crud => crud.entityKey)).toEqual([
      'stock-item',
      'stock-movement',
      'reservation',
    ]);
  });

  it('names each screen from the entity’s own decorator', () => {
    // The tab caption and the table heading come from the same place, so one
    // cannot drift from the other.
    expect(stockItemCrud.entityLabelKey).toBe('entity:stock-item.label');
    expect(stockItemCrud.entityPluralKey).toBe('entity:stock-item.plural');
    expect(stockMovementCrud.entityPluralKey).toBe(
      'entity:stock-movement.plural',
    );
    expect(reservationCrud.entityLabelKey).toBe('entity:reservation.label');
  });

  it('generates each screen at the route its surface declares', () => {
    expect(stockItemCrud.basePath).toBe('/stock/stock-item');
    expect(stockMovementCrud.basePath).toBe('/stock/stock-movement');
    expect(reservationCrud.basePath).toBe('/stock/reservation');
  });
});

describe('the listing pages', () => {
  it.each([
    ['items', <StockItemListClientPage key="i" />],
    ['movements', <StockMovementListClientPage key="m" />],
    ['reservations', <ReservationListClientPage key="r" />],
  ])('lists %s from the adapters it was given', async (_label, page) => {
    renderPage(page);

    await waitFor(() =>
      expect(screen.getAllByText('product-offering-1').length).toBeGreaterThan(
        0,
      ),
    );
  });

  it('renders the fold’s two counters as columns', async () => {
    // Derived from the entity's `@accessor()` metadata, which is what makes the
    // screen a generated one rather than a written one.
    //
    // Asserted on the **column header** rather than the text: the label also
    // appears in the sort and column-visibility controls, so a bare text query
    // matches three elements.
    renderPage(<StockItemListClientPage />);

    await waitFor(() =>
      expect(
        screen.getByRole('columnheader', { name: 'En almacén' }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('columnheader', { name: 'Reservado' }),
    ).toBeInTheDocument();
  });
});

describe('the single views', () => {
  /**
   * ⚠️ **A movement is the one write in this domain**, so its create form is an
   * ordinary generated one: a signed quantity and a reason, checked against
   * each other server-side. `id` is hidden because `record-movement.ts` mints
   * it — asking an operator to type a value the service overwrites.
   */
  it('offers the movement form its three authored members and hides the id', async () => {
    renderPage(<StockMovementSingleViewClientPage />);

    expect(await screen.findByLabelText('ID de oferta')).toBeInTheDocument();
    expect(screen.getByLabelText('Cantidad')).toBeInTheDocument();
    expect(screen.getByLabelText('Motivo')).toBeInTheDocument();
    expect(screen.queryByLabelText('ID')).not.toBeInTheDocument();
  });

  /**
   * The item's single view renders without a metadata answer here, which is the
   * pre-ADR-0026 path — what withholds Save in the app is the served
   * descriptor, and that behaviour is covered where it lives, in
   * `make-entity-crud`. What this asserts is only that the screen exists and
   * reads the record it was addressed with.
   */
  it('opens an item by its slug', async () => {
    slug = 'stock-item-1';

    renderPage(<StockItemSingleViewClientPage />);

    await waitFor(() =>
      expect(
        screen.getAllByDisplayValue('product-offering-1').length +
          screen.queryAllByText('product-offering-1').length,
      ).toBeGreaterThan(0),
    );
  });
});
