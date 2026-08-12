import { createHmac } from 'node:crypto';

import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  ACTION_SIGNATURE_HEADER,
  ACTION_SIGNATURE_TOLERANCE_SECONDS,
  makeZitadelActions,
  PROVIDER_USER_LIFECYCLE_EVENTS,
  verifyActionSignature,
  ZitadelActionsLayer,
  ZitadelActionsTag,
} from './action-webhook.js';

const SIGNING_KEY = 'signing-key-1';

const NOW = 1_760_000_000;

// The verifier reads the wall clock when the caller does not pass one, and every
// signature here is stamped `NOW` — so the clock has to be pinned there or the
// tolerance check would turn into a test of today's date.
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
});

afterAll(() => {
  vi.useRealTimers();
});

const body = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    aggregateID: 'zitadel-user-1',
    aggregateType: 'user',
    event_type: 'user.deactivated',
    created_at: '2026-08-11T10:00:00Z',
    ...overrides,
  });

/** Exactly how Zitadel signs: `HMAC-SHA256(key, "<t>.<raw body>")`, hex. */
const sign = (raw: string, at = NOW, key = SIGNING_KEY) =>
  createHmac('sha256', key)
    .update(`${String(at)}.${raw}`)
    .digest('hex');

const header = (raw: string, at = NOW, key = SIGNING_KEY) =>
  `t=${String(at)},v1=${sign(raw, at, key)}`;

describe('verifyActionSignature', () => {
  it('accepts a payload signed with the configured key', () => {
    const raw = body();
    expect(verifyActionSignature(raw, header(raw), SIGNING_KEY, NOW)).toBe(
      true,
    );
  });

  it('accepts a header carrying several v1 parts', () => {
    const raw = body();
    const multi = `t=${String(NOW)},v1=${sign(raw, NOW, 'other-key')},v1=${sign(raw)}`;
    expect(verifyActionSignature(raw, multi, SIGNING_KEY, NOW)).toBe(true);
  });

  it('tolerates a timestamp inside the window, in either direction', () => {
    const raw = body();
    const past = NOW - ACTION_SIGNATURE_TOLERANCE_SECONDS;
    const future = NOW + ACTION_SIGNATURE_TOLERANCE_SECONDS;
    expect(
      verifyActionSignature(raw, header(raw, past), SIGNING_KEY, NOW),
    ).toBe(true);
    expect(
      verifyActionSignature(raw, header(raw, future), SIGNING_KEY, NOW),
    ).toBe(true);
  });

  it('defaults the clock to now', () => {
    const raw = body();
    expect(verifyActionSignature(raw, header(raw), SIGNING_KEY)).toBe(true);
  });

  // The fail-closed rule: a fleet whose key never arrived must reject
  // everything, not accept anonymous revocation requests.
  it('rejects everything when no signing key is configured', () => {
    const raw = body();
    expect(verifyActionSignature(raw, header(raw, NOW, ''), '', NOW)).toBe(
      false,
    );
  });

  it('rejects a missing header', () => {
    expect(verifyActionSignature(body(), undefined, SIGNING_KEY, NOW)).toBe(
      false,
    );
  });

  it.each([
    ['no parts at all', 'nonsense'],
    ['no timestamp', `v1=${'0'.repeat(64)}`],
    ['a non-numeric timestamp', `t=soon,v1=${'0'.repeat(64)}`],
    ['no signature', `t=${String(NOW)}`],
    ['an empty signature', `t=${String(NOW)},v1=`],
  ])('rejects a header with %s', (_name, value) => {
    expect(verifyActionSignature(body(), value, SIGNING_KEY, NOW)).toBe(false);
  });

  it('rejects a timestamp outside the tolerance', () => {
    const raw = body();
    const stale = NOW - ACTION_SIGNATURE_TOLERANCE_SECONDS - 1;
    expect(
      verifyActionSignature(raw, header(raw, stale), SIGNING_KEY, NOW),
    ).toBe(false);
  });

  it('rejects a signature made with another key', () => {
    const raw = body();
    expect(
      verifyActionSignature(
        raw,
        header(raw, NOW, 'other-key'),
        SIGNING_KEY,
        NOW,
      ),
    ).toBe(false);
  });

  it('rejects a signature of the wrong length', () => {
    const raw = body();
    expect(
      verifyActionSignature(raw, `t=${String(NOW)},v1=abcd`, SIGNING_KEY, NOW),
    ).toBe(false);
  });

  // The MAC covers the bytes, so a body edited after signing must not verify.
  it('rejects a body altered after signing', () => {
    const raw = body();
    const tampered = body({ aggregateID: 'zitadel-user-2' });
    expect(verifyActionSignature(tampered, header(raw), SIGNING_KEY, NOW)).toBe(
      false,
    );
  });
});

describe('makeZitadelActions', () => {
  const actions = makeZitadelActions({ signingKey: SIGNING_KEY });

  const verify = (raw: string, sig: string | undefined) =>
    Effect.runSync(Effect.either(actions.verifyEvent(raw, sig)));

  it.each(PROVIDER_USER_LIFECYCLE_EVENTS)(
    'reports %s as revoking sessions',
    eventType => {
      const raw = body({ event_type: eventType });
      const result = verify(raw, header(raw));
      expect(result).toMatchObject({
        _tag: 'Right',
        right: { eventType, subject: 'zitadel-user-1', revokesSessions: true },
      });
    },
  );

  // An execution can be added at the provider without a deploy here, so an
  // unrecognised type is a no-op rather than an error.
  it('verifies an event it does not act on', () => {
    const raw = body({ event_type: 'user.human.added' });
    expect(verify(raw, header(raw))).toMatchObject({
      _tag: 'Right',
      right: { eventType: 'user.human.added', revokesSessions: false },
    });
  });

  it('fails when the signature does not verify', () => {
    const raw = body();
    expect(verify(raw, header(raw, NOW, 'other-key'))._tag).toBe('Left');
  });

  it.each([
    ['a body that is not JSON', 'not-json'],
    ['a body that is not an object', '"a string"'],
    ['a body that is null', 'null'],
    ['no event_type', JSON.stringify({ aggregateID: 'u1' })],
    ['an empty event_type', body({ event_type: '' })],
    ['no aggregateID', JSON.stringify({ event_type: 'user.deactivated' })],
    ['an empty aggregateID', body({ aggregateID: '' })],
  ])('fails on %s', (_name, raw) => {
    expect(verify(raw, header(raw))._tag).toBe('Left');
  });
});

describe('ZitadelActionsLayer', () => {
  it('provides the tag', () => {
    const raw = body();
    const verified = Effect.runSync(
      ZitadelActionsTag.pipe(
        Effect.flatMap(actions => actions.verifyEvent(raw, header(raw))),
        Effect.provide(ZitadelActionsLayer({ signingKey: SIGNING_KEY })),
      ),
    );
    expect(verified.subject).toBe('zitadel-user-1');
  });

  it('names the header the sender uses', () => {
    expect(ACTION_SIGNATURE_HEADER).toBe('zitadel-signature');
  });
});
