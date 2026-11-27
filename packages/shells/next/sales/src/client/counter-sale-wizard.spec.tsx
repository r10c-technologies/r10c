import { EntityRepositoryTag } from '@entifix/business';
import type { Entity } from '@entifix/core';
import { useDraftsState } from '@entifix/next-shell';
import {
  EntifixQueryProvider,
  makePendingFlowStore,
  type PendingFlowStore,
  PendingFlowStoreProvider,
} from '@entifix/react-integration';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { SalesChannel } from '@r10c/business-ts-sales-management';
import { settledWriter } from '@r10c/testing-cells/writer';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Context } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createClientAdapters } from './adapters/create-client-adapters.js';
import type { SalesAdapters } from './client-types.js';
import {
  COUNTER_SALE_WIZARD,
  CounterSaleWizard,
  currencyOf,
  lastChannelKey,
  linesFiltering,
  previewOf,
  quantityTextOf,
  readLines,
  scanPick,
  tillFiltering,
  withLine,
} from './counter-sale-wizard.js';
import { SalesProvider } from './sales-context.js';

/** The transports the shell really composes, so metadata reads behave as in production. */
const real = createClientAdapters();

/**
 * The address, as a tiny store the router writes and the search params read.
 *
 * A no-op router was enough while every move went through `goTo`. The till now
 * also moves by writing the address — a sole channel opens it on the lines, and
 * the follower turns that push into the move — so the address has to answer
 * what was pushed, or the spec would assert a till the browser never shows.
 */
const address = vi.hoisted(() => {
  let params = new URLSearchParams();
  const listeners = new Set<() => void>();
  return {
    read: () => params,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    go: (url: string) => {
      params = new URLSearchParams(url.split('?')[1] ?? '');
      for (const listener of listeners) listener();
    },
  };
});

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useRouter: () => ({ push: address.go, replace: address.go }),
    usePathname: () => '/sales/counter-sale',
    useSearchParams: () =>
      useSyncExternalStore(address.subscribe, address.read),
  };
});

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

const phoneChannel = () => {
  const channel = new SalesChannel('Pedidos por teléfono', 'phone');
  channel.id = 'sales-channel-phone';
  return channel;
};

/** Six active channels: more than a row of buttons offers, so a select. */
const manyChannels = (): SalesChannel[] => [
  activeChannel(),
  phoneChannel(),
  ...[1, 2, 3, 4].map(n => {
    const channel = new SalesChannel(`Sucursal ${n}`, 'counter');
    channel.id = `sales-channel-branch-${n}`;
    return channel;
  }),
  retiredChannel(),
];

/** A counter and a phone line, and a retired kiosk: a row of buttons. */
const twoChannels = (): SalesChannel[] => [
  activeChannel(),
  phoneChannel(),
  retiredChannel(),
];

const publishedOffering = () => {
  const offering = new PublishedOffering();
  offering.id = 'published-1';
  offering.offeringId = 'product-offering-1';
  offering.vendorId = 'demo-organization';
  offering.name = 'Café de altura';
  offering.amount = 6499;
  offering.currency = 'GTQ';
  offering.publishedAt = new Date('2026-09-01T00:00:00.000Z');
  // One piece at a time, priced for one (ADR 0082).
  offering.saleUnit = 'UN';
  offering.quantityStep = 1;
  offering.quantityMinimum = 1;
  offering.pricePer = 1;
  offering.searchText = 'Café de altura';
  return offering;
};

/** Sold by the half metre from one metre, at Q45 the metre. */
const cable = () =>
  Object.assign(publishedOffering(), {
    id: 'published-cable',
    offeringId: 'cable',
    name: 'Cable',
    amount: 4500,
    saleUnit: 'M',
    quantityStep: 500,
    quantityMinimum: 1000,
    searchText: 'Cable THHN',
  });

/** Another vendor's product, which this till never lists. */
const theirs = () =>
  Object.assign(publishedOffering(), {
    id: 'published-theirs',
    offeringId: 'theirs',
    vendorId: 'other-organization',
    name: 'Café ajeno',
    searchText: 'Café ajeno',
  });

const adapters = (
  channels: () => SalesChannel[] = twoChannels,
): SalesAdapters => ({
  salesChannelRest: Context.make(
    EntityRepositoryTag,
    makeInMemoryEntityRepository(channels() as Entity[]),
  ),
  salesChannelWriter: settledWriter(
    Context.make(
      EntityRepositoryTag,
      makeInMemoryEntityRepository(channels() as Entity[]),
    ),
  ),
  publishedOfferingRest: Context.make(
    EntityRepositoryTag,
    makeInMemoryEntityRepository([
      publishedOffering(),
      // The projection answering the same offering twice: the picker lists it once.
      Object.assign(publishedOffering(), { id: 'published-1-again' }),
      cable(),
      theirs(),
    ] as Entity[]),
  ),
  metadata: real.metadata,
});

/** The till's pending flows: what a `202` hands off to, and settles from. */
let flows: PendingFlowStore;

const renderTill = ({
  channels,
  scope,
  vendorId = 'demo-organization',
  ...props
}: {
  step?: string;
  onFinished?: () => void;
  channels?: () => SalesChannel[];
  scope?: string;
  vendorId?: string;
} = {}) =>
  render(
    <EntifixQueryProvider>
      <PendingFlowStoreProvider store={flows}>
        <SalesProvider
          adapters={adapters(channels)}
          scope={scope}
          vendorId={vendorId}
        >
          <CounterSaleWizard {...props} />
        </SalesProvider>
      </PendingFlowStoreProvider>
    </EntifixQueryProvider>,
  );

/** The channel step as a row of buttons, once the channels have loaded. */
const channelChoice = async (name: string) =>
  screen.findByRole('radio', { name });

/** The service accepted the sale: a checkout is running under `flowId`. */
const accepted = (flowId = 'flow-1') => ({
  status: 202,
  json: async () => ({
    meta: { type: 'flowAccepted', entity: 'counter-sale' },
    data: { flowId, links: [] },
  }),
});

/** The checkout the till is waiting on ends, as its push would say. */
const settle = async (
  outcome: Parameters<PendingFlowStore['settle']>[1] = { kind: 'confirmed' },
  flowId = 'flow-1',
) => {
  await waitFor(() =>
    expect(flows.list().map(flow => flow.flowId)).toContain(flowId),
  );
  act(() => {
    flows.settle(flowId, outcome);
  });
};

/** Walks the flow to the summary, leaving one line of two units on it. */
const ringUp = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await channelChoice('Mostrador principal'));
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
  // Tender codes are copy, never the wire value.
  expect(screen.getByRole('option', { name: 'Efectivo' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'cash' })).toBeNull();
  await user.click(screen.getByRole('button', { name: /Continuar/i }));
};

beforeEach(() => {
  // ⚠️ The draft store is a module-level zustand store, so a till left
  // half-rung by one test is still there for the next: the second sale would
  // carry the first one's lines and the assertion would pass or fail on
  // ordering. Clearing the *store*, not `localStorage`, is what resets it.
  useDraftsState.setState({ drafts: {} });
  // The remembered channel lives in the preference store, which falls back to
  // `localStorage` without a provider; one test's sale must not preselect the
  // next one's channel.
  localStorage.clear();
  address.go('/sales/counter-sale');
  flows = makePendingFlowStore();
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

    // A retired channel stays readable and the route refuses it, so offering it
    // here would be offering a dead end.
    expect(await channelChoice('Mostrador principal')).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Pedidos por teléfono' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('radio', { name: 'Kiosco cerrado' }),
    ).not.toBeInTheDocument();
  });

  it('offers more than five channels as a select, retired ones left out', async () => {
    renderTill({ channels: manyChannels });

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Canal' })).toBeEnabled(),
    );
    expect(screen.getAllByRole('option')).toHaveLength(7);
    expect(
      screen.queryByRole('option', { name: 'Kiosco cerrado' }),
    ).not.toBeInTheDocument();
  });

  it('will not advance past the channel until one is picked', async () => {
    renderTill({ channels: manyChannels });

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Canal' })).toBeEnabled(),
    );
    expect(screen.getByRole('button', { name: /Continuar/i })).toBeDisabled();
  });

  it('totals the lines it was given, at the price the projection carries', async () => {
    const user = userEvent.setup();
    renderTill();

    await ringUp(user);

    // 2 × 6499 minor units — display only. The route re-prices every line server-side, so a
    // total computed here that disagreed would be a bug in this file alone,
    // never a mischarge.
    // Minor units, formatted: 12998 is Q 129.98, never "12998 GTQ".
    // `Money` renders the figure in a span of its own, so the line is matched
    // by its own words and the amount by the whole line's text.
    expect(await screen.findByText(/^Total:/)).toHaveTextContent(/Q\s129\.98/);
    // The quantity with its unit, as every quantity reads (ADR 0082 §2).
    expect(screen.getByText(/^2 u\. × Café de altura —/)).toHaveTextContent(
      /Q\s129\.98/,
    );
  });

  it('previews a line by its live published terms, and one no longer listed as nothing', () => {
    const line = {
      key: 'k',
      offeringId: 'cable',
      name: 'Cable',
      amount: 0,
      currency: 'GTQ',
      quantity: 3500,
    };
    // 3.5 m at Q45.00 the metre: Q157.50, by `lineTotal` (ADR 0082 §6).
    const cable = Object.assign(new PublishedOffering('cable', 'v', 'Cable'), {
      amount: 4500,
      currency: 'GTQ',
      saleUnit: 'M' as const,
      pricePer: 1 as const,
    });

    expect(previewOf(line, [cable])).toBe(15_750);
    expect(previewOf(line, [])).toBe(0);
    // From 3 m at Q40.00: the whole line at the volume price (ADR 0082 §8).
    const tiered = Object.assign(cable, {
      tiers: [{ from: 3000, amount: 4000 }],
    });
    expect(previewOf(line, [tiered])).toBe(14_000);
  });

  it('writes a line’s quantity in its offering’s unit, and a bare one when it is gone', () => {
    const [read] = readLines([{ offeringId: 'cable', quantity: '3500' }]);
    const line = read as NonNullable<typeof read>;
    const symbol = (key: string) => (key.endsWith('.M') ? 'm' : key);

    expect(quantityTextOf(line, [cable()], 'es', symbol)).toBe('3.5 m');
    expect(quantityTextOf(line, [], 'es', symbol)).toBe('3500');
  });

  it('empties the quantity again when the product is un-picked', async () => {
    const user = userEvent.setup();
    renderTill();
    await user.click(await channelChoice('Mostrador principal'));
    await user.click(screen.getByRole('button', { name: /Continuar/i }));
    const picker = await screen.findByRole('combobox', { name: 'Producto' });
    await waitFor(() => expect(picker).toBeEnabled());

    await user.selectOptions(picker, 'cable');
    await user.selectOptions(picker, '');

    expect(screen.getByRole('spinbutton', { name: 'Cantidad' })).toBeDisabled();
  });

  it('sends offering ids and quantities, never prices', async () => {
    const fetchMock = vi.fn().mockResolvedValue(accepted());
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderTill();

    await ringUp(user);
    await user.click(screen.getByRole('button', { name: /Finalizar/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // The channel's own `sell` verb: the channel is the record it is bound to.
    expect(url).toBe('/api/sales/sales-channel/sales-channel-counter/sell');
    expect(JSON.parse(String(init.body))).toEqual({
      paymentMethod: 'cash',
      buyerTax: { idType: 'cf' },
      lines: [{ offeringId: 'product-offering-1', quantity: 2 }],
    });
  });

  it('charges again under the same key only when the first never arrived', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        status: 409,
        json: async () => ({ code: 'channelInactive' }),
      })
      .mockResolvedValue(accepted());
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderTill();

    await ringUp(user);
    const finish = screen.getByRole('button', { name: /Finalizar/i });
    await user.click(finish);
    await screen.findByText('Algo salió mal.');
    await user.click(finish);
    await screen.findByText('Ese canal de venta está inactivo.');
    await user.click(finish);
    await settle();
    await screen.findByText('Venta registrada');

    const keys = fetchMock.mock.calls.map(
      ([, init]) =>
        (init as RequestInit & { headers: Record<string, string> }).headers[
          'idempotency-key'
        ],
    );
    // Lost in transit: the retry is the same checkout. Answered: the sale was
    // decided, and the next charge is a new one.
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('tells the seller the sale landed, and offers the next one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(accepted()));
    const user = userEvent.setup();
    renderTill();

    await ringUp(user);
    await user.click(screen.getByRole('button', { name: /Finalizar/i }));
    // Nothing is sold until the checkout completes.
    expect(screen.queryByText('Venta registrada')).toBeNull();
    await settle();

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

  it('says something generic for a checkout that failed without saying why', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(accepted()));
    const user = userEvent.setup();
    renderTill();

    await ringUp(user);
    await user.click(screen.getByRole('button', { name: /Finalizar/i }));
    await settle({ kind: 'failed' });

    expect(await screen.findByText('Algo salió mal.')).toBeVisible();
  });

  it('keeps the basket when the checkout fails', async () => {
    // A line's hold was refused and every hold taken was released: the flow
    // fails with the refusal's code. The seller can act on that, so the lines
    // they typed have to still be there.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(accepted()));
    const user = userEvent.setup();
    renderTill();

    await ringUp(user);
    await user.click(screen.getByRole('button', { name: /Finalizar/i }));
    await settle({
      kind: 'failed',
      failure: { code: 'insufficientStock' } as never,
    });

    expect(
      await screen.findByText('No hay existencia suficiente para reservar.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Total:/)).toHaveTextContent(/Q\s129\.98/);
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

    await user.click(await channelChoice('Pedidos por teléfono'));
    await user.click(screen.getByRole('button', { name: /Continuar/i }));
    await screen.findByRole('combobox', { name: 'Producto' });

    await user.click(screen.getByRole('button', { name: /Atrás/i }));

    expect(await channelChoice('Pedidos por teléfono')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('blocks again when the channel is cleared', async () => {
    const user = userEvent.setup();
    renderTill({ channels: manyChannels });

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Canal' })).toBeEnabled(),
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Canal' }),
      'sales-channel-counter',
    );
    expect(screen.getByRole('button', { name: /Continuar/i })).toBeEnabled();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Canal' }),
      '',
    );

    expect(screen.getByRole('button', { name: /Continuar/i })).toBeDisabled();
  });
});

describe('the lines step', () => {
  const reachLines = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await channelChoice('Mostrador principal'));
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
      screen.getByText('Agregue al menos un producto para cobrar.'),
    ).toBeVisible();
  });

  // Refused rather than rounded up to what is sold (ADR 0082 §3): the field
  // says why, and nothing reaches the basket.
  it('refuses a quantity below what the offering sells, and adds nothing', async () => {
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
    await user.tab();

    await user.click(screen.getByRole('button', { name: 'Agregar producto' }));

    expect(quantity).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText('Es menos del mínimo que se vende de este producto.'),
    ).toBeVisible();
    expect(
      screen.getByText('Agregue al menos un producto para cobrar.'),
    ).toBeVisible();
  });

  it('sells a measured offering in its unit, from its minimum', async () => {
    const user = userEvent.setup();
    renderTill();
    await reachLines(user);
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Producto' }),
      'cable',
    );
    const quantity = screen.getByRole('spinbutton', { name: 'Cantidad' });
    expect(quantity).toHaveValue('1');

    await user.clear(quantity);
    await user.type(quantity, '3.5');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Agregar producto' }));

    expect(await screen.findByText(/^3\.5 m × Cable/)).toBeVisible();
  });

  // A line keeps its live terms from a read of its own: the search list holds
  // only what matches what is typed next.
  it('keeps a line priced while the search looks for the next product', async () => {
    const user = userEvent.setup();
    renderTill();
    await reachLines(user);
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Producto' }),
      'cable',
    );
    await user.click(screen.getByRole('button', { name: 'Agregar producto' }));

    await user.type(screen.getByRole('searchbox'), 'café');
    await waitFor(() =>
      expect(
        screen.queryByRole('option', { name: 'Cable' }),
      ).not.toBeInTheDocument(),
    );

    // Read from the line's own offering: priced from the search list, the
    // line would read a bare 1000 and preview nothing.
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent?.replace(/\s+/g, ' ').trim() === '1 m × Cable',
      ),
    ).toBeVisible();
  });

  // What a scanner does: the code and Enter, faster than the list answers.
  it('picks a scanned product once the list answers its code, and clears the field', async () => {
    renderTill();
    await reachLines(userEvent.setup());
    const search = screen.getByRole('searchbox');

    fireEvent.change(search, { target: { value: 'thhn' } });
    fireEvent.keyDown(search, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Producto' })).toHaveValue(
        'cable',
      ),
    );
    expect(search).toHaveValue('');
  });

  it('drops a scan the cashier typed past before the list answered', async () => {
    renderTill();
    await reachLines(userEvent.setup());
    const search = screen.getByRole('searchbox');

    fireEvent.change(search, { target: { value: 'thhn' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    fireEvent.change(search, { target: { value: 'thhn café' } });

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Producto' })).toBeEnabled(),
    );
    expect(screen.getByRole('combobox', { name: 'Producto' })).toHaveValue('');
    expect(search).toHaveValue('thhn café');
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
      screen.getAllByRole('option', { name: 'Café de altura' }),
    ).toHaveLength(1);
    expect(
      await screen.findByRole('button', { name: 'Quitar Café de altura' }),
    ).toBeVisible();

    await user.click(
      screen.getByRole('button', { name: 'Quitar Café de altura' }),
    );

    expect(
      await screen.findByText('Agregue al menos un producto para cobrar.'),
    ).toBeVisible();
  });
});

describe('charging', () => {
  it('sends the payment method the seller picked', async () => {
    const fetchMock = vi.fn().mockResolvedValue(accepted());
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderTill();

    await user.click(await channelChoice('Mostrador principal'));
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

  it('bills a NIT the seller typed, and waits for both its number and name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(accepted());
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderTill();

    await user.click(await channelChoice('Mostrador principal'));
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
      await screen.findByRole('combobox', { name: 'Facturar a' }),
      'nit',
    );
    const next = screen.getByRole('button', { name: /Continuar/i });
    expect(next).toBeDisabled();
    await user.type(
      screen.getByRole('textbox', { name: 'Número de NIT o CUI' }),
      '12345679',
    );
    expect(next).toBeDisabled();
    await user.type(
      screen.getByRole('textbox', { name: 'Nombre en la factura' }),
      'Ferretería Sol',
    );
    await user.click(screen.getByRole('button', { name: /Continuar/i }));
    expect(
      await screen.findByText(/Facturado a: 12345679 — Ferretería Sol/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Finalizar/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).buyerTax).toEqual({
      idType: 'nit',
      taxId: '12345679',
      name: 'Ferretería Sol',
    });
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(accepted()));
    const user = userEvent.setup();
    renderTill({ onFinished });

    await ringUp(user);
    await user.click(screen.getByRole('button', { name: /Finalizar/i }));
    await settle();
    await user.click(
      await screen.findByRole('button', { name: 'Nueva venta' }),
    );

    expect(onFinished).toHaveBeenCalled();
    expect(await channelChoice('Mostrador principal')).toBeVisible();
  });
});

describe('choosing the channel for the seller', () => {
  it('opens on the lines when the vendor sells through one channel', async () => {
    renderTill({ channels: () => [activeChannel(), retiredChannel()] });

    expect(
      await screen.findByRole('combobox', { name: 'Producto' }),
    ).toBeVisible();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('still reaches the channel step with Back, showing the one it chose', async () => {
    const user = userEvent.setup();
    renderTill({ channels: () => [activeChannel()] });
    await screen.findByRole('combobox', { name: 'Producto' });

    await user.click(screen.getByRole('button', { name: /Atrás/i }));

    expect(await channelChoice('Mostrador principal')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('names the channel on the summary, so a skipped answer is seen', async () => {
    const user = userEvent.setup();
    renderTill();

    await ringUp(user);

    expect(screen.getByText(/Canal: Mostrador principal/)).toBeVisible();
  });

  it('preselects the channel this scope last sold through', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(accepted()));
    const user = userEvent.setup();
    const first = renderTill({ scope: 'user-2:demo-organization' });
    await user.click(await channelChoice('Pedidos por teléfono'));
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
    await user.click(screen.getByRole('button', { name: /Continuar/i }));
    await user.click(screen.getByRole('button', { name: /Finalizar/i }));
    await waitFor(() =>
      expect(flows.list().map(flow => flow.flowId)).toContain('flow-1'),
    );
    first.unmount();
    useDraftsState.setState({ drafts: {} });

    renderTill({ scope: 'user-2:demo-organization' });

    await waitFor(async () =>
      expect(await channelChoice('Pedidos por teléfono')).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
  });

  it('remembers nothing for another scope, or without one', async () => {
    localStorage.setItem(
      'entifix-ui:sales.counter-sale.last-channel:user-2:demo-organization',
      JSON.stringify('sales-channel-phone'),
    );
    renderTill({ scope: 'user-9:other-organization' });

    expect(await channelChoice('Mostrador principal')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(lastChannelKey(undefined)).toBeUndefined();
  });

  it('leaves the step to the seller when no channel can take a sale', async () => {
    renderTill({ channels: () => [retiredChannel()] });

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Canal' })).toBeEnabled(),
    );
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Continuar/i })).toBeDisabled();
  });

  it('preselects nothing in a select it has no memory for', async () => {
    renderTill({ channels: manyChannels });

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Canal' })).toBeEnabled(),
    );
    expect(screen.getByRole('combobox', { name: 'Canal' })).toHaveValue('');
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

describe('the till’s product list', () => {
  it('reads the vendor’s own products, narrowed by every word typed', () => {
    expect(tillFiltering('v-1', ' cable  thhn ')).toEqual({
      operator: 'and',
      values: [
        { property: 'vendorId', operator: 'eq', value: 'v-1' },
        { property: 'searchText', operator: 'like', value: 'cable' },
        { property: 'searchText', operator: 'like', value: 'thhn' },
      ],
    });
    expect(tillFiltering(undefined, '')).toBeUndefined();
  });

  it('reads the sale’s own lines among the vendor’s products', () => {
    expect(linesFiltering('v-1', ['a', 'b'])).toEqual({
      operator: 'and',
      values: [
        { property: 'vendorId', operator: 'eq', value: 'v-1' },
        { property: 'offeringId', operator: 'in', values: ['a', 'b'] },
      ],
    });
    expect(linesFiltering(undefined, ['a']).values).toEqual([
      { property: 'offeringId', operator: 'in', values: ['a'] },
    ]);
  });

  it('picks on Enter only the one product the words found', () => {
    expect(scanPick([cable()], 'cable')?.offeringId).toBe('cable');
    expect(scanPick([cable(), publishedOffering()], 'cable')).toBeUndefined();
    expect(scanPick([], 'cable')).toBeUndefined();
  });

  it('picks the offering whose SKU is exactly what was scanned, among the ones its words found', () => {
    const tac8 = { offeringId: 'tac-8', sku: 'TAC-8' };
    const tac80 = { offeringId: 'tac-80', sku: 'TAC-80' };

    expect(scanPick([tac80, tac8], ' TAC-8 ')?.offeringId).toBe('tac-8');
    expect(scanPick([tac80, { offeringId: 'x' }], 'TAC-8')).toBeUndefined();
  });

  it('adds to the line a sale already holds, and a new line otherwise', () => {
    const one = { offeringId: 'a', quantity: 1 };

    expect(withLine([one], { offeringId: 'a', quantity: 2 })).toEqual([
      { offeringId: 'a', quantity: 3 },
    ]);
    expect(
      withLine([one, { offeringId: 'b', quantity: 1 }], {
        offeringId: 'b',
        quantity: 1,
      }),
    ).toEqual([one, { offeringId: 'b', quantity: 2 }]);
    expect(withLine([one], { offeringId: 'c', quantity: 1 })).toHaveLength(2);
  });

  it('lists none of another vendor’s products, and a scan picks the one it names', async () => {
    const user = userEvent.setup();
    renderTill();
    await user.click(await channelChoice('Mostrador principal'));
    await user.click(screen.getByRole('button', { name: /Continuar/i }));
    const picker = await screen.findByRole('combobox', { name: 'Producto' });
    await waitFor(() => expect(picker).toBeEnabled());

    expect(
      screen.queryByRole('option', { name: 'Café ajeno' }),
    ).not.toBeInTheDocument();

    const search = screen.getByRole('searchbox', {
      name: 'Buscar o escanear un producto',
    });
    // Two products answer nothing typed: Enter picks neither.
    await user.type(search, '{Enter}');
    expect(picker).toHaveValue('');
    await user.type(search, 'thhn{Enter}');

    await waitFor(() => expect(picker).toHaveValue('cable'));
  });
});
