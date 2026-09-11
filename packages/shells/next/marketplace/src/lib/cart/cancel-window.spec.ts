import { describe, expect, it } from 'vitest';

import { cancelWindowLabel } from './cancel-window';
import type { Receipt } from './receipt-state';

const NOW = new Date('2026-09-11T12:00:00.000Z');
const OPEN = new Date('2026-09-11T12:30:00.000Z').toISOString();
const CLOSED = new Date('2026-09-11T11:30:00.000Z').toISOString();

const receipt = (extra: Partial<Receipt> = {}): Receipt => ({
  orderId: 'order-1',
  lineCount: 1,
  totals: [{ currency: 'GTQ', amount: 1999 }],
  cancelNonce: 'a'.repeat(64),
  cancelWindowEndsAt: OPEN,
  ...extra,
});

describe('cancelWindowLabel', () => {
  it('names the time the window closes', () => {
    expect(cancelWindowLabel('es', receipt(), NOW)).toMatch(/\d/);
  });

  /**
   * ⚠️ A counter sale carries no nonce, because at a till there is no browser to
   * hold one. Offering the button anyway would be discovering the answer from a
   * `401`.
   */
  it('offers nothing without a nonce', () => {
    expect(
      cancelWindowLabel('es', receipt({ cancelNonce: undefined }), NOW),
    ).toBeUndefined();
  });

  it('offers nothing without a window', () => {
    expect(
      cancelWindowLabel('es', receipt({ cancelWindowEndsAt: undefined }), NOW),
    ).toBeUndefined();
  });

  it('offers nothing once the window has closed', () => {
    expect(
      cancelWindowLabel('es', receipt({ cancelWindowEndsAt: CLOSED }), NOW),
    ).toBeUndefined();
  });

  it('treats the closing instant as closed', () => {
    expect(
      cancelWindowLabel(
        'es',
        receipt({ cancelWindowEndsAt: NOW.toISOString() }),
        NOW,
      ),
    ).toBeUndefined();
  });

  /**
   * ⚠️ Everything in the cookie is untrusted. A `NaN` compares false against
   * every bound, so without the explicit check a garbage stamp would open the
   * window rather than close it.
   */
  it('closes the window on an unparseable stamp', () => {
    expect(
      cancelWindowLabel('es', receipt({ cancelWindowEndsAt: 'nope' }), NOW),
    ).toBeUndefined();
  });

  it('offers nothing on an order already cancelled from this browser', () => {
    expect(
      cancelWindowLabel('es', receipt({ cancelled: true }), NOW),
    ).toBeUndefined();
  });
});
