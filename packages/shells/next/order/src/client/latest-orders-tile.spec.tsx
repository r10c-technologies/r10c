import { EntityRepositoryTag } from '@entifix/business';
import type { Entity } from '@entifix/core';
import { EntifixQueryProvider } from '@entifix/react-integration';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { ProductOrder } from '@r10c/business-ts-order-management';
import { fireEvent, render, screen } from '@testing-library/react';
import { Context, Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { createClientAdapters } from './adapters/create-client-adapters.js';
import {
  LATEST_ORDERS,
  LatestOrdersTile,
  placedOn,
} from './latest-orders-tile.js';
import { OrderProvider } from './order-context.js';

vi.mock('next/navigation', () => ({
  usePathname: () => '/es/home',
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

const anOrder = (id: string, day: number, placed = true) => {
  const order = new ProductOrder('party-user-1');
  order.id = id;
  if (placed) order.placedAt = new Date(Date.UTC(2026, 10, day, 12));
  return order;
};

const renderTile = (
  repository: ReturnType<typeof makeInMemoryEntityRepository>,
) =>
  render(
    <EntifixQueryProvider>
      <OrderProvider
        adapters={{
          ...createClientAdapters(),
          productOrderRest: Context.make(EntityRepositoryTag, repository),
        }}
      >
        <LatestOrdersTile />
      </OrderProvider>
    </EntifixQueryProvider>,
  );

describe('LatestOrdersTile', () => {
  it('lists the latest orders, newest first, each leading to its record', async () => {
    renderTile(
      makeInMemoryEntityRepository(
        Array.from({ length: LATEST_ORDERS + 2 }, (_, index) =>
          anOrder(`order-${index + 1}`, index + 1, index !== 0),
        ) as Entity[],
      ),
    );

    const links = await screen.findAllByRole('link', {
      name: /order-|Pedido|r10c/,
    });
    const records = links.filter(link =>
      /\/order\/product-order\/order-/.test(link.getAttribute('href') ?? ''),
    );
    expect(records).toHaveLength(LATEST_ORDERS);
    expect(records[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/\/order\/product-order\/order-7$/),
    );
  });

  it('lists an order with no placing time without a date beside it', async () => {
    renderTile(
      makeInMemoryEntityRepository([anOrder('order-9', 1, false)] as Entity[]),
    );

    const link = await screen.findByRole('link', {
      name: (_, element) => /order-9$/.test(element.getAttribute('href') ?? ''),
    });
    expect(link.closest('li')).not.toHaveTextContent(/2026/);
  });

  it('says there are none yet when there are none', async () => {
    renderTile(makeInMemoryEntityRepository([]));

    expect(
      await screen.findByText(/order.home.none|No orders yet|no ha recibido/),
    ).toBeVisible();
  });

  it('says it failed, and reads again on Retry', async () => {
    const repository = makeInMemoryEntityRepository([
      anOrder('order-1', 1),
    ] as Entity[]);
    const load = vi
      .spyOn(repository, 'load')
      .mockReturnValueOnce(Effect.die('down') as never);
    renderTile(repository);

    fireEvent.click(await screen.findByRole('button'));
    await screen.findByRole('link', {
      name: (_, element) => /order-1$/.test(element.getAttribute('href') ?? ''),
    });
    expect(load.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('placedOn', () => {
  it('reads a Date, or the ISO string a list read hands back, and nothing else', () => {
    const order = new ProductOrder('party-user-1');
    expect(placedOn(order)).toBeUndefined();

    order.placedAt = new Date('2026-11-03T10:00:00.000Z');
    expect(placedOn(order)?.toISOString()).toBe('2026-11-03T10:00:00.000Z');

    Object.assign(order, { placedAt: '2026-11-04T10:00:00.000Z' });
    expect(placedOn(order)?.toISOString()).toBe('2026-11-04T10:00:00.000Z');

    Object.assign(order, { placedAt: 'not a date' });
    expect(placedOn(order)).toBeUndefined();
  });
});
