import { EntifixQueryProvider } from '@r10c/entifix-react-integration';
import type { TransactionRecord } from '@r10c/entifix-transactions';
import { render } from '@testing-library/react';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

const subscribe = vi.fn(() => () => undefined);
const onConnect = vi.fn(() => () => undefined);
// Typed with its parameter: an inferred zero-arg spy type-checks under vitest
// but not under `tsc`, and the URL is the thing this spec asserts on.
const makeChannel = vi.fn((_url: string) => ({ subscribe, onConnect }));
const useReactiveInvalidation = vi.fn();
const useTransactionSettlement = vi.fn();

// The transport is stubbed at the module edge rather than driven: jsdom ships no
// `EventSource`, and what this component is responsible for is *which* URL it
// opens and *what* it wires together — the settlement behaviour itself is
// `useTransactionSettlement`'s own spec.
vi.mock('@r10c/entifix-react-integration', async () => {
  const actual = await vi.importActual<
    typeof import('@r10c/entifix-react-integration')
  >('@r10c/entifix-react-integration');
  return {
    ...actual,
    makeEventSourceReactiveChannel: (url: string) => makeChannel(url),
    useReactiveInvalidation: (channel: unknown) =>
      useReactiveInvalidation(channel),
    useTransactionSettlement: (options: unknown) =>
      useTransactionSettlement(options),
  };
});

const aRecord: TransactionRecord = {
  transactionId: 'tx-1',
  entity: 'product-specification',
  state: 'COMPLETED',
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:01.000Z',
};

// Stubbed so calling `read` exercises the real Effect composition — the
// `runPromise`/`provide`/`flatMap` this component owns — without a network call.
// Whether the adapter itself speaks HTTP correctly is its own spec's job.
const read = vi.fn(() => Effect.succeed<TransactionRecord | undefined>(aRecord));

vi.mock('@r10c/entifix-ts-rest-client', async () => {
  const actual = await vi.importActual<
    typeof import('@r10c/entifix-ts-rest-client')
  >('@r10c/entifix-ts-rest-client');
  return {
    ...actual,
    buildTransactionStatusReader: () => Effect.succeed({ read }),
  };
});

const { TransactionSettlement } = await import('./transaction-settlement.js');

const renderIt = () =>
  render(
    <EntifixQueryProvider>
      <TransactionSettlement />
    </EntifixQueryProvider>,
  );

describe('TransactionSettlement', () => {
  // It is a mount point, not a widget: anything it rendered would appear on
  // every authenticated page.
  it('renders nothing', () => {
    const { container } = renderIt();

    expect(container).toBeEmptyDOMElement();
  });

  // ⚠️ Same-origin through the app's own proxy. `r10c_at` is httpOnly, so the
  // cookie is the only credential available and a cross-origin connection would
  // carry none (ADR 0036) — a changed URL here is a stream that silently
  // authenticates as nobody.
  it('opens the stream on the same-origin proxy path', () => {
    renderIt();

    expect(makeChannel).toHaveBeenCalledWith('/api/admin/transaction/events');
  });

  it('wires both consumers to that one channel', () => {
    renderIt();

    const channel = makeChannel.mock.results[0]?.value;
    expect(useReactiveInvalidation).toHaveBeenCalledWith(channel);
    expect(useTransactionSettlement).toHaveBeenCalledWith(
      expect.objectContaining({ channel }),
    );
  });

  // One connection for the whole app: the channel is built at module scope, so
  // remounting must not open a second `EventSource`.
  it('does not open a second connection when it remounts', () => {
    const before = makeChannel.mock.calls.length;

    renderIt().unmount();
    renderIt();

    expect(makeChannel.mock.calls.length).toBe(before);
  });

  it('hands the settlement hook a reader that resolves a record', async () => {
    renderIt();

    const options = useTransactionSettlement.mock.calls.at(-1)?.[0] as {
      read: (id: string) => Promise<TransactionRecord | undefined>;
      pending: unknown;
    };

    expect(options.pending).toBeDefined();
    await expect(options.read('tx-1')).resolves.toEqual(aRecord);
    expect(read).toHaveBeenCalledWith('tx-1');
  });
});
