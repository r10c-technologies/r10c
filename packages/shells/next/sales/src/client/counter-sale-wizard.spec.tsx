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
  currencyOf,
  readLines,
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

const renderTill = (props: { step?: string; onFinished?: () => void } = {}) =>
  render(
    <EntifixQueryProvider>
      <SalesProvider adapters={adapters()}>
        <CounterSaleWizard {...props} />
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

  it('falls back to the catch-all when the refusal carries no readable body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 500,
        json: async () => {
          throw new Error('not json');
        },
      }),
    );
    const user = userEvent.setup();
    renderTill();

    await ringUp(user);
    await user.click(screen.getByRole('button', { name: /Finalizar/i }));

    expect(await screen.findByText('Algo salió mal.')).toBeVisible();
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

describe('walking the till', () => {
  it('opens at the step its address names', async () => {
    // A workspace tab addressed `wizard:counter-sale:payment` opens there. It is
    // honoured once, so a later render does not drag the seller back.
    renderTill({ step: 'payment' });

    expect(
      await screen.findByRole('combobox', { name: 'Forma de pago' }),
    ).toBeVisible();
  });

  it('goes back to the step before', async () => {
    const user = userEvent.setup();
    renderTill();

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Canal' })).toBeEnabled(),
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Canal' }),
      'sales-channel-counter',
    );
    await user.click(screen.getByRole('button', { name: /Continuar/i }));
    await screen.findByRole('combobox', { name: 'Producto' });

    await user.click(screen.getByRole('button', { name: /Atrás/i }));

    expect(
      await screen.findByRole('combobox', { name: 'Canal' }),
    ).toHaveValue('sales-channel-counter');
  });

  it('blocks again when the channel is cleared', async () => {
    const user = userEvent.setup();
    renderTill();

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Canal' })).toBeEnabled(),
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Canal' }),
      'sales-channel-counter',
    );
    expect(screen.getByRole('button', { name: /Continuar/i })).toBeEnabled();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Canal' }), '');

    expect(screen.getByRole('button', { name: /Continuar/i })).toBeDisabled();
  });
});

describe('the lines step', () => {
  const reachLines = async (user: ReturnType<typeof userEvent.setup>) => {
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
  };

  it('adds nothing when no product is chosen', async () => {
    const user = userEvent.setup();
    renderTill();
    await reachLines(user);

    await user.click(screen.getByRole('button', { name: 'Agregar producto' }));

    expect(
      screen.getByText('Agrega al menos un producto para cobrar.'),
    ).toBeVisible();
  });

  it('adds nothing for a quantity that is not a whole unit', async () => {
    const user = userEvent.setup();
    renderTill();
    await reachLines(user);
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Producto' }),
      'product-offering-1',
    );
    const quantity = screen.getByRole('spinbutton', { name: 'Cantidad' });
    await user.clear(quantity);
    await user.type(quantity, '0');

    await user.click(screen.getByRole('button', { name: 'Agregar producto' }));

    expect(
      screen.getByText('Agrega al menos un producto para cobrar.'),
    ).toBeVisible();
  });

  it('removes a line the seller changed their mind about', async () => {
    const user = userEvent.setup();
    renderTill();
    await reachLines(user);
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Producto' }),
      'product-offering-1',
    );
    await user.click(screen.getByRole('button', { name: 'Agregar producto' }));
    // The offering's name is also an `<option>` in the picker above, so the
    // line is found by the button that removes it rather than by its text.
    expect(
      await screen.findByRole('button', { name: 'Quitar' }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Quitar' }));

    expect(
      await screen.findByText('Agrega al menos un producto para cobrar.'),
    ).toBeVisible();
  });
});

describe('charging', () => {
  it('sends the payment method the seller picked', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ status: 201, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderTill();

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
    await user.click(screen.getByRole('button', { name: 'Agregar producto' }));
    await user.click(screen.getByRole('button', { name: /Continuar/i }));
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Forma de pago' }),
      'card',
    );
    await user.click(screen.getByRole('button', { name: /Continuar/i }));
    await user.click(await screen.findByRole('button', { name: /Finalizar/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).paymentMethod).toBe('card');
  });

  it('says something generic when the service cannot be reached', async () => {
    // `fetch` rejecting is not a refusal the seller can act on, so it reports
    // the catch-all rather than inventing a stock reason.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const user = userEvent.setup();
    renderTill();

    await ringUp(user);
    await user.click(screen.getByRole('button', { name: /Finalizar/i }));

    expect(await screen.findByText('Algo salió mal.')).toBeVisible();
  });

  it('hands the host its ending, and starts the next sale at the top', async () => {
    const onFinished = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 201, json: async () => ({}) }),
    );
    const user = userEvent.setup();
    renderTill({ onFinished });

    await ringUp(user);
    await user.click(screen.getByRole('button', { name: /Finalizar/i }));
    await user.click(await screen.findByRole('button', { name: 'Nueva venta' }));

    expect(onFinished).toHaveBeenCalled();
    expect(await screen.findByRole('combobox', { name: 'Canal' })).toBeVisible();
  });
});

describe('reading a stored till', () => {
  it('defaults every member of a row a previous build wrote', () => {
    // ⚠️ A draft is not trusted: what comes back from storage was written by
    // whatever build was running then (ADR 0032). A row missing a member has to
    // restore as an empty one, or `undefined` reaches an input and flips it
    // from controlled to uncontrolled mid-render.
    const [line] = readLines([{ $key: 'row-1' }]);

    expect(line).toEqual({
      key: 'row-1',
      offeringId: '',
      name: '',
      amount: 0,
      currency: '',
      quantity: 0,
    });
  });

  it('mints a key for a row that lost its own', () => {
    const [line] = readLines([{ offeringId: 'product-offering-1' }]);

    expect(line?.key).toMatch(/[0-9a-f-]{36}/);
  });
});

describe('currencyOf', () => {
  it('takes the currency of the first line', () => {
    expect(
      currencyOf([
        {
          key: 'a',
          offeringId: 'product-offering-1',
          name: 'Café',
          amount: 25,
          currency: 'GTQ',
          quantity: 1,
        },
      ]),
    ).toBe('GTQ');
  });

  it('answers empty for an empty till, rather than a currency nobody chose', () => {
    expect(currencyOf([])).toBe('');
  });
});
