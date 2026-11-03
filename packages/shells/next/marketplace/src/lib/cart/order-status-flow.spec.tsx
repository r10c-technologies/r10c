import { render, screen } from '@testing-library/react';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@entifix/rest', () => ({
  buildFlowStatusReader: () => () => Effect.succeed(undefined),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { OrderStatusFlow } = await import('./order-status-flow.js');

describe('OrderStatusFlow', () => {
  it('mounts the island over the browser’s own flow-status reader', () => {
    render(
      <OrderStatusFlow
        flowId="f-1"
        capability="cap"
        statusHref="/api/realtime/flow/f-1"
        locale="es"
        labels={{ pending: 'Waiting', failed: 'Failed', retry: 'Retry' }}
        settle={() => Promise.resolve('pending')}
        retry={() => undefined}
      />,
    );

    expect(screen.getByTestId('order-pending').textContent).toBe('Waiting');
  });
});
