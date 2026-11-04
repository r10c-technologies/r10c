import {
  type FlowStatusRead,
  makePendingFlowStore,
  PendingFlowStoreProvider,
} from '@entifix/react-integration';
import { act, render, screen } from '@testing-library/react';
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { heldCapabilities } from './flow-capabilities.js';
import { OrderStatusIsland } from './order-status-island.js';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const LABELS = { pending: 'Waiting', failed: 'It failed', retry: 'Retry' };

const statusOf =
  (state?: string): FlowStatusRead =>
  () =>
    Effect.succeed(
      state === undefined
        ? undefined
        : ({ flowId: 'f-1', state } as Parameters<
            typeof JSON.stringify
          >[0] as never),
    );

const flush = () =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });

const mount = (
  options: {
    state?: string;
    settled?: 'settled' | 'pending' | 'failed';
    store?: ReturnType<typeof makePendingFlowStore>;
    readStatus?: FlowStatusRead;
  } = {},
) => {
  const settle = vi.fn(() => Promise.resolve(options.settled ?? 'settled'));
  const island = (
    <OrderStatusIsland
      flowId="f-1"
      capability="cap-1"
      statusHref="/api/realtime/flow/f-1?capability=cap-1"
      locale="es"
      labels={LABELS}
      settle={settle}
      retry={() => undefined}
      readStatus={options.readStatus ?? statusOf(options.state)}
    />
  );
  const view = render(
    options.store === undefined ? (
      island
    ) : (
      <PendingFlowStoreProvider store={options.store}>
        {island}
      </PendingFlowStoreProvider>
    ),
  );
  return { ...view, settle };
};

beforeEach(() => {
  refresh.mockReset();
});

describe('OrderStatusIsland', () => {
  it('waits while the flow runs, holding its capability for the stream', async () => {
    const { unmount } = mount({ state: 'running' });
    await flush();

    expect(screen.getByTestId('order-pending').textContent).toBe('Waiting');
    expect(heldCapabilities()).toEqual(['cap-1']);
    unmount();
    expect(heldCapabilities()).toEqual([]);
  });

  it('settles a flow its catch-up read finds completed, and re-renders', async () => {
    const { settle } = mount({ state: 'completed' });
    await flush();

    expect(settle).toHaveBeenCalledWith('f-1');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows the failure and a retry for a flow that ended badly', async () => {
    mount({ state: 'compensated' });
    await flush();

    expect(screen.getByTestId('order-failed').textContent).toBe('It failed');
    expect(screen.getByTestId('order-retry')).toBeTruthy();
  });

  it('keeps waiting when the server cannot settle yet, and fails when it refuses', async () => {
    const pending = mount({ state: 'completed', settled: 'pending' });
    await flush();
    expect(refresh).not.toHaveBeenCalled();
    pending.unmount();

    mount({ state: 'completed', settled: 'failed' });
    await flush();
    expect(screen.getByTestId('order-failed')).toBeTruthy();
  });

  it('settles by push through the pending-flow store', async () => {
    const store = makePendingFlowStore({ anonymous: true });
    const confirmed = mount({ store });
    await flush();

    act(() => {
      store.settle('f-1', { kind: 'confirmed' });
    });
    await flush();
    expect(confirmed.settle).toHaveBeenCalledWith('f-1');
    confirmed.unmount();

    const other = makePendingFlowStore({ anonymous: true });
    mount({ store: other });
    await flush();
    act(() => {
      other.settle('f-1', { kind: 'failed' });
    });
    expect(screen.getByTestId('order-failed')).toBeTruthy();
  });

  it('ignores a catch-up read that fails or arrives after it left', async () => {
    const failing = mount({ readStatus: () => Effect.fail('down') });
    await flush();
    expect(screen.getByTestId('order-pending')).toBeTruthy();
    failing.unmount();

    let resolve: (value: unknown) => void = () => undefined;
    const late = mount({
      readStatus: () =>
        Effect.promise(
          () =>
            new Promise(done => {
              resolve = done;
            }),
        ) as never,
    });
    late.unmount();
    resolve({ flowId: 'f-1', state: 'completed' });
    await flush();
    expect(late.settle).not.toHaveBeenCalled();
  });

  it('drops a settle answer that arrives after it left', async () => {
    let answer: (value: 'settled') => void = () => undefined;
    const settle = vi.fn(
      () =>
        new Promise<'settled'>(done => {
          answer = done;
        }),
    );
    const view = render(
      <OrderStatusIsland
        flowId="f-1"
        capability="cap-1"
        statusHref="/api/realtime/flow/f-1?capability=cap-1"
        locale="es"
        labels={LABELS}
        settle={settle}
        retry={() => undefined}
        readStatus={statusOf('completed')}
      />,
    );
    await flush();
    expect(settle).toHaveBeenCalledWith('f-1');
    view.unmount();
    answer('settled');
    await flush();
    expect(refresh).not.toHaveBeenCalled();
  });
});
