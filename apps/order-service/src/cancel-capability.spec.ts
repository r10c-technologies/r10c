import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { digestOf, verifyCancelCapability } from './cancel-capability.js';

const NOW = new Date('2026-09-11T12:00:00.000Z');
const OPEN = new Date('2026-09-11T12:20:00.000Z');
const CLOSED = new Date('2026-09-11T11:40:00.000Z');

const nonce = randomBytes(32).toString('hex');

const order = (overrides: Record<string, unknown> = {}) => ({
  cancelDigest: digestOf(nonce),
  cancelWindowEndsAt: OPEN,
  ...overrides,
});

describe('digestOf', () => {
  it('is stable, and is not the nonce', () => {
    expect(digestOf(nonce)).toBe(digestOf(nonce));
    expect(digestOf(nonce)).not.toBe(nonce);
    expect(digestOf(nonce)).toHaveLength(64);
  });

  it('separates two nonces', () => {
    expect(digestOf(nonce)).not.toBe(digestOf(randomBytes(32).toString('hex')));
  });
});

describe('verifyCancelCapability', () => {
  it('accepts the nonce the order was placed with', () => {
    expect(verifyCancelCapability(order(), nonce, NOW)).toBeUndefined();
  });

  it('refuses a nonce that is not it', () => {
    expect(verifyCancelCapability(order(), 'not-the-nonce', NOW)).toBe(
      'badCapability',
    );
  });

  /**
   * ⚠️ Knowing the digest must not be enough. It is serialized on every read of
   * the order, so a vendor reading their own order sees it — and presenting it
   * has to fail exactly as any other wrong value does.
   */
  it('refuses the digest itself, presented as the nonce', () => {
    expect(verifyCancelCapability(order(), digestOf(nonce), NOW)).toBe(
      'badCapability',
    );
  });

  it('refuses once the window has closed', () => {
    expect(
      verifyCancelCapability(order({ cancelWindowEndsAt: CLOSED }), nonce, NOW),
    ).toBe('windowClosed');
  });

  it('reads the window as the ISO string a round trip leaves behind', () => {
    expect(
      verifyCancelCapability(
        order({ cancelWindowEndsAt: OPEN.toISOString() }),
        nonce,
        NOW,
      ),
    ).toBeUndefined();
  });

  /**
   * ⚠️ A window that cannot be read must close, never stay open. An unparseable
   * timestamp is the one case where failing safe and failing open differ by a
   * refund.
   */
  it('closes a window it cannot read', () => {
    expect(
      verifyCancelCapability(
        order({ cancelWindowEndsAt: 'not-a-date' }),
        nonce,
        NOW,
      ),
    ).toBe('windowClosed');
  });

  /**
   * ⚠️ "No capability was required" must not be reachable from "no capability
   * was presented". A counter sale carries no digest, and nobody may cancel it
   * this way.
   */
  it('refuses every nonce on an order that carries no digest', () => {
    const counterSale = { cancelWindowEndsAt: OPEN };

    expect(verifyCancelCapability(counterSale, nonce, NOW)).toBe(
      'noCapability',
    );
    expect(verifyCancelCapability(counterSale, undefined, NOW)).toBe(
      'noCapability',
    );
    expect(verifyCancelCapability(counterSale, '', NOW)).toBe('noCapability');
  });

  it('refuses an order with a digest but no window', () => {
    expect(
      verifyCancelCapability({ cancelDigest: digestOf(nonce) }, nonce, NOW),
    ).toBe('noCapability');
  });

  it('refuses an absent nonce against a real capability', () => {
    expect(verifyCancelCapability(order(), undefined, NOW)).toBe(
      'badCapability',
    );
    expect(verifyCancelCapability(order(), '', NOW)).toBe('badCapability');
  });
});
