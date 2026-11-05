import { EntityRepositoryTag } from '@entifix/business';
import type { Entity } from '@entifix/core';
import { type EntityWriter, settled } from '@entifix/core';
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
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Context, Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createClientAdapters } from './adapters/create-client-adapters.js';
import type { SalesAdapters } from './client-types.js';
import {
  COUNTER_SALE_WIZARD,
  CounterSaleWizard,
  currencyOf,
  readLines,
} from './counter-sale-wizard.js';
import { SalesProvider } from './sales-context.js';

/**
 * A writer that settles every write through the spec's own in-memory
 * repository, as a write that commits in one unit does (ADR 0073).
 */
const settledWriter = (
  context: Context.Context<EntityRepositoryTag>,
): EntityWriter => {
  const repository = Context.get(context, EntityRepositoryTag);
  return {
    save: entity => Effect.map(repository.save(entity), settled),
    delete: entityOrId =>
      Effect.as(repository.delete(entityOrId), settled(undefined)),
  };
};

/** The transports the shell really composes, so metadata reads behave as in production. */
const real = createClientAdapters();

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
  offering.amount = 6499;
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
  salesChannelWriter: settledWriter(
    Context.make(
      EntityRepositoryTag,
      makeInMemoryEntityRepository([
        activeChannel(),
        retiredChannel(),
      ] as Entity[]),
    ),
  ),
  publishedOfferingRest: Context.make(
    EntityRepositoryTag,
    makeInMemoryEntityRepository([
      publishedOffering(),
      // The projection answering the same offering twice: the picker lists it once.
      Object.assign(publishedOffering(), { id: 'published-1-again' }),
    ] as Entity[]),
  ),
  metadata: real.metadata,
});

/** The till's pending flows: what a `202` hands off to, and settles from. */
let flows: PendingFlowStore;

const renderTill = (props: { step?: string; onFinished?: () => void } = {}) =>
  render(
    <EntifixQueryProvider>
      <PendingFlowStoreProvider store={flows}>
        <SalesProvider adapters={adapters()}>
          <CounterSaleWizard {...props} />
        </SalesProvider>
      </PendingFlowStoreProvider>
    </EntifixQueryProvider>,
  );

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

    // 2 × 6499 minor units — display only. The route re-prices every line server-side, so a
    // total computed here that disagreed would be a bug in this file alone,
    // never a mischarge.
    // Minor units, formatted: 12998 is 129,98 quetzales, never "12998 GTQ".
    expect(await screen.findByText(/Total: 129,98\sGTQ/)).toBeInTheDocument();
    expect(screen.getByText(/2 × Café de altura — 129,98\sGTQ/)).toBeVisible();
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
    expect(screen.getByText(/Total: 129,98\sGTQ/)).toBeInTheDocument();
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

    expect(await screen.findByRole('combobox', { name: 'Canal' })).toHaveValue(
      'sales-channel-counter',
    );
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

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Canal' }),
      '',
    );

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
      screen.getByText('Agregue al menos un producto para cobrar.'),
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
      screen.getByText('Agregue al menos un producto para cobrar.'),
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
    expect(
      await screen.findByRole('combobox', { name: 'Canal' }),
    ).toBeVisible();
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
