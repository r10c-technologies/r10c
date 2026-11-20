import {
  makeInMemoryPushChannel,
  recordTopic,
} from '@entifix/react-integration';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { heldCapabilities } from './flow-capabilities.js';
import {
  StorefrontPushProvider,
  useStorefrontPushChannel,
} from './push-channel-context.js';
import { ReceiptWatch } from './receipt-watch.js';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const HINT = {
  name: 'entity.changed',
  id: 'h-1',
  source: 'order-service',
  at: '2026-11-19T10:00:00.000Z',
  data: { entity: 'product-order', change: 'updated', id: 'o-1' },
};

describe('ReceiptWatch', () => {
  it('holds the receipt’s capability, re-renders on a hint for one of its orders, and lets go', () => {
    refresh.mockClear();
    const channel = makeInMemoryPushChannel();
    const { container, unmount } = render(
      <StorefrontPushProvider channel={channel}>
        <ReceiptWatch capability="nonce-1" orderIds={['o-1', 'o-2']} />
      </StorefrontPushProvider>,
    );

    expect(container.textContent).toBe('');
    expect(heldCapabilities()).toContain('nonce-1');
    expect(channel.topics()).toEqual([
      recordTopic('product-order', 'o-1'),
      recordTopic('product-order', 'o-2'),
    ]);

    channel.emit([recordTopic('product-order', 'o-1')], HINT as never);
    channel.resync([recordTopic('product-order', 'o-2')]);
    expect(refresh).toHaveBeenCalledTimes(2);

    unmount();
    expect(heldCapabilities()).not.toContain('nonce-1');
    expect(channel.topics()).toEqual([]);
  });
});

describe('useStorefrontPushChannel', () => {
  it('answers a channel that never connects when no host gave one', () => {
    let seen: unknown;
    function Probe() {
      seen = useStorefrontPushChannel();
      return null;
    }
    render(<Probe />);

    expect(
      (seen as { connection: () => string } | undefined)?.connection(),
    ).toBeDefined();
  });
});
