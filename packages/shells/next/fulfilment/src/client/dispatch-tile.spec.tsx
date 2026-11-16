import { EntityRepositoryTag } from '@entifix/business';
import type { Entity } from '@entifix/core';
import { EntifixQueryProvider } from '@entifix/react-integration';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import {
  ShippingOrder,
  type ShippingStatus,
} from '@r10c/business-ts-shipping-order-management';
import { render, screen } from '@testing-library/react';
import { Context, Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { createClientAdapters } from './adapters/create-client-adapters.js';
import { DispatchTile } from './dispatch-tile.js';
import { FulfilmentProvider } from './fulfilment-context.js';

vi.mock('next/navigation', () => ({
  usePathname: () => '/es/home',
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

const aShipment = (id: string, status: ShippingStatus) =>
  Object.assign(new ShippingOrder(), { id, orderId: `order-${id}`, status });

const real = createClientAdapters();

const renderTile = (
  repository: ReturnType<typeof makeInMemoryEntityRepository>,
) =>
  render(
    <EntifixQueryProvider>
      <FulfilmentProvider
        adapters={{
          ...real,
          shippingOrderRest: Context.make(EntityRepositoryTag, repository),
        }}
      >
        <DispatchTile />
      </FulfilmentProvider>
    </EntifixQueryProvider>,
  );

describe('DispatchTile', () => {
  it('counts what waits for dispatch, and leads to the worklist', async () => {
    renderTile(
      makeInMemoryEntityRepository([
        aShipment('so-1', 'awaiting-dispatch'),
        aShipment('so-2', 'awaiting-dispatch'),
        aShipment('so-3', 'dispatched'),
      ] as Entity[]),
    );

    const link = await screen.findByRole('link', { name: /2/ });
    expect(link).toHaveAttribute(
      'href',
      expect.stringMatching(/\/fulfilment\/shipping-order$/),
    );
  });

  it('says so in place when the count cannot be read, and offers a retry', async () => {
    const repository = makeInMemoryEntityRepository([]);
    vi.spyOn(repository, 'load').mockReturnValue(Effect.die('down') as never);
    renderTile(repository);

    expect(await screen.findByRole('button', { name: /./ })).toBeVisible();
  });
});
