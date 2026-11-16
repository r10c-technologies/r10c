import type { VendorBalance } from '@r10c/business-ts-settlement-management';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  createClientAdapters,
  readVendorBalance,
} from './adapters/create-client-adapters.js';
import { BalanceTile } from './balance-tile.js';
import { SettlementProvider } from './settlement-context.js';

vi.mock('next/navigation', () => ({
  usePathname: () => '/es/home',
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

const renderTile = (vendorBalance: () => Promise<VendorBalance>) =>
  render(
    <SettlementProvider adapters={{ ...createClientAdapters(), vendorBalance }}>
      <BalanceTile />
    </SettlementProvider>,
  );

describe('BalanceTile', () => {
  it('shows what the next run will pay, as money, and leads to the payouts', async () => {
    renderTile(() =>
      Promise.resolve({ amount: 2300, currency: 'GTQ', unsettledEntries: 2 }),
    );

    const link = await screen.findByRole('link', { name: /23/ });
    expect(link).toHaveAttribute(
      'href',
      expect.stringMatching(/\/settlement\/vendor-payout$/),
    );
  });

  it('reads an empty balance as nothing, in no currency', async () => {
    renderTile(() => Promise.resolve({ amount: 0, unsettledEntries: 0 }));

    expect(await screen.findByRole('link', { name: /0/ })).toBeVisible();
  });

  it('says it failed, retries on request, and reads again on focus', async () => {
    const read = vi
      .fn<() => Promise<VendorBalance>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ amount: 100, currency: 'GTQ', unsettledEntries: 1 });
    renderTile(read);

    fireEvent.click(await screen.findByRole('button'));
    expect(await screen.findByRole('link', { name: /1/ })).toBeVisible();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('ignores an answer that arrives after it is gone', async () => {
    let answer: (balance: VendorBalance) => void = () => undefined;
    const { unmount } = renderTile(
      () =>
        new Promise(resolve => {
          answer = resolve;
        }),
    );
    unmount();
    answer({ amount: 1, unsettledEntries: 1 });
    await Promise.resolve();

    const failing = renderTile(
      () =>
        new Promise((_, reject) => {
          answer = () => reject(new Error('late'));
        }),
    );
    failing.unmount();
    answer({ amount: 1, unsettledEntries: 1 });
    await Promise.resolve();
  });
});

describe('readVendorBalance', () => {
  it('reads the balance through the same-origin proxy', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ amount: 5, unsettledEntries: 1 }), {
        status: 200,
      }),
    );

    expect(await readVendorBalance(fetcher)).toEqual({
      amount: 5,
      unsettledEntries: 1,
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/settlement/vendor-balance');
  });

  it('is what the real adapter set reads through', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ amount: 0, unsettledEntries: 0 })),
      );
    vi.stubGlobal('fetch', fetcher);

    await createClientAdapters().vendorBalance();
    expect(fetcher).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('rejects an answer that is not a balance', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));

    await expect(readVendorBalance(fetcher)).rejects.toThrow('503');
  });
});
