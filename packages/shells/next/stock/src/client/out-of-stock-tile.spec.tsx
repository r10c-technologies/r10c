import { EntityRepositoryTag } from '@entifix/business';
import type { Entity } from '@entifix/core';
import { EntifixQueryProvider } from '@entifix/react-integration';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { StockItem } from '@r10c/business-ts-stock-management';
import { render, screen } from '@testing-library/react';
import { Context } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { createClientAdapters } from './adapters/create-client-adapters.js';
import { OutOfStockTile } from './out-of-stock-tile.js';
import { StockProvider } from './stock-context.js';

vi.mock('next/navigation', () => ({
  usePathname: () => '/es/home',
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

const anItem = (id: string, onHand: number, reserved: number) => {
  const item = new StockItem(`offering-${id}`);
  item.id = id;
  item.onHand = onHand;
  item.reserved = reserved;
  item.available = onHand - reserved;
  return item;
};

describe('OutOfStockTile', () => {
  it('counts the positions with nothing left to sell, and leads to the stock list', async () => {
    const repository = makeInMemoryEntityRepository([
      anItem('si-1', 0, 0),
      anItem('si-2', 3, 3),
      anItem('si-3', 10, 2),
    ] as Entity[]);
    render(
      <EntifixQueryProvider>
        <StockProvider
          adapters={{
            ...createClientAdapters(),
            stockItemRest: Context.make(EntityRepositoryTag, repository),
          }}
        >
          <OutOfStockTile />
        </StockProvider>
      </EntifixQueryProvider>,
    );

    const link = await screen.findByRole('link', { name: /2/ });
    expect(link).toHaveAttribute(
      'href',
      expect.stringMatching(/\/stock\/stock-item$/),
    );
  });
});
