import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { SalesChannel } from '@r10c/business-ts-sales-management';
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
import { useDraftsState } from '@r10c/shells-next-common';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Context } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SalesAdapters } from './client-types.js';
import {
  COUNTER_SALE_WIZARD,
  CounterSaleWizard,
} from './counter-sale-wizard.js';
import { SalesProvider } from './sales-context.js';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/sales/counter-sale',
  useSearchParams: () => new URLSearchParams(),
}));

const activeChannel = () => {
  const channel = new SalesChannel('Mostrador principal', 'counter');
  channel.id = 'sales-channel-counter';
  return channel;
};

const retiredChannel = () => {
  const channel = new SalesChannel('Kiosco cerrado', 'counter');
  channel.id = 'sales-channel-retired';
  channel.status = 'inactive';
  return channel;
};

const publishedOffering = () => {
  const offering = new PublishedOffering();
  offering.id = 'published-1';
  offering.offeringId = 'product-offering-1';
  offering.vendorId = 'demo-organization';
  offering.name = 'Café de altura';
  offering.amount = 25;
  offering.currency = 'GTQ';
  offering.publishedAt = new Date('2026-09-01T00:00:00.000Z');
  return offering;
};

const adapters = (): SalesAdapters => ({
  salesChannelRest: Context.make(
    EntityRepositoryTag,
    makeInMemoryEntityRepository([
      activeChannel(),
      retiredChannel(),
    ] as Entity[]),
  ),
  publishedOfferingRest: Context.make(
    EntityRepositoryTag,
    makeInMemoryEntityRepository([publishedOffering()] as Entity[]),
  ),
  configurationStore: Context.make(
    ConfigurationRepositoryTag,
    makeStubConfigurationClient(),
  ),
});

const renderTill = () =>
  render(
    <EntifixQueryProvider>
      <SalesProvider adapters={adapters()}>
        <CounterSaleWizard />
      </SalesProvider>
    </EntifixQueryProvider>,
  );

/** Walks the flow to the summary, leaving one line of two units on it. */
const ringUp = async (user: ReturnType<typeof userEvent.setup>) => {
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Canal' })).toBeEnabled(),
  );
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Canal' }),
    'sales-channel-counter',
  );
  await user.click(screen.getByRole('button', { name: /Continuar/i }));

  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Producto' })).toBeEnabled(),
  );
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Producto' }),
    'product-offering-1',
  );
  const quantity = screen.getByRole('spinbutton', { name: 'Cantidad' });
  await user.clear(quantity);
  await user.type(quantity, '2');
  await user.click(screen.getByRole('button', { name: 'Agregar producto' }));
  await user.click(screen.getByRole('button', { name: /Continuar/i }));

  await screen.findByRole('combobox', { name: 'Forma de pago' });
  await user.click(screen.getByRole('button', { name: /Continuar/i }));
};

beforeEach(() => {
  // ⚠️ The draft store is a module-level zustand store, so a till left
  // half-rung by one test is still there for the next: the second sale would
  // carry the first one's lines and the assertion would pass or fail on
  // ordering. Clearing the *store*, not `localStorage`, is what resets it.
  useDraftsState.setState({ drafts: {} });
  vi.spyOn(useDraftsState.persist, 'rehydrate').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the counter sale definition', () => {
  it('ends on a summary, because the last step takes money', () => {
    // `assertWizardDefinition` runs at module load and requires exactly one
    // summary at the end. Charging without the seller seeing what they are
    // charging for is the failure that rule exists for.
    const last = COUNTER_SALE_WIZARD.steps.at(-1);

    expect(last?.kind).toBe('summary');
    expect(last?.to).toEqual([]);
  });

  it('walks channel, then lines, then payment', () => {
    expect(COUNTER_SALE_WIZARD.steps.map(step => step.id)).toEqual([
      'channel',
      'lines',
      'payment',
      'summary',
    ]);
  });
});

describe('the till', () => {
  it('offers only channels that can take a sale', async () => {
    renderTill();

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Canal' })).toBeEnabled(),
    );
    // A retired channel stays readable and the route refuses it, so offering it
    // here would be offering a dead end.
    expect(
      screen.queryByRole('option', { name: 'Kiosco cerrado' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Mostrador principal' }),
    ).toBeInTheDocument();
  });

  it('will not advance past the channel until one is picked', async () => {
    renderTill();

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Canal' })).toBeEnabled(),
    );
    expect(screen.getByRole('button', { name: /Continuar/i })).toBeDisabled();
  });

  it('totals the lines it was given, at the price the projection carries', async () => {
    const user = userEvent.setup();
    renderTill();

    await ringUp(user);

    // 2 × 25 — display only. The route re-prices every line server-side, so a
    // total computed here that disagreed would be a bug in this file alone,
    // never a mischarge.
    expect(await screen.findByText(/Total: 50 GTQ/)).toBeInTheDocument();
  });

  it('sends offering ids and quantities, never prices', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 201,
      json: async () => ({ data: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderTill();

    await ringUp(user);
    await user.click(screen.getByRole('button', { name: /Finalizar/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sales/counter-sale');
    expect(JSON.parse(String(init.body))).toEqual({
      channelId: 'sales-channel-counter',
      paymentMethod: 'cash',
      lines: [{ offeringId: 'product-offering-1', quantity: 2 }],
    });
  });

  it('tells the seller the sale landed, and offers the next one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 201, json: async () => ({}) }),
    );
    const user = userEvent.setup();
    renderTill();

    await ringUp(user);
    await user.click(screen.getByRole('button', { name: /Finalizar/i }));

    expect(await screen.findByText('Venta registrada')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Nueva venta' }),
    ).toBeInTheDocument();
  });

  it('keeps the basket when the sale is refused', async () => {
    // A `409` is the saga's own answer for "compensated": a line was refused
    // and every hold taken was released. The seller can act on that, so the
    // lines they typed have to still be there.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 409,
        json: async () => ({ code: 'unavailable' }),
      }),
    );
    const user = userEvent.setup();
    renderTill();

    await ringUp(user);
    await user.click(screen.getByRole('button', { name: /Finalizar/i }));

    expect(
      await screen.findByText(/No se pudo completar la venta/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Total: 50 GTQ/)).toBeInTheDocument();
  });
});
