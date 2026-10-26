import { SessionStoreTag } from '@entifix/business';
import { ZitadelManagementTag } from '@entifix/zitadel';
import { AccountRepositoryTag } from '@r10c/business-ts-authn';
import { LifecycleCursorTag } from '@r10c/business-ts-authn';
import { Effect, Layer } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { reconcileOnce } from './lifecycle-reconciler';

interface Event {
  readonly subject: string;
  readonly type: string;
  readonly createdAt: string;
}

const SINCE = '2026-09-11T00:00:00.000Z';

/**
 * The four collaborators `reconcileOnce` reaches for, as doubles.
 *
 * `searchEvents` is the only method of the management client this touches, so
 * the rest of that interface is cast past rather than stubbed — a fake with six
 * unused methods would suggest this depends on them.
 */
const wiring = (options: {
  events: readonly Event[];
  accounts?: Record<string, string | null>;
  /** Each user's live sessions, by id and the moment it opened. */
  sessions?: Record<string, readonly { id: string; createdAt: string }[]>;
}) => {
  const searchEvents = vi.fn(() => Effect.succeed(options.events));
  const listForUser = vi.fn((userId: string) =>
    Effect.succeed(
      (options.sessions?.[userId] ?? []).map(session => ({
        sessionId: session.id,
        createdAt: session.createdAt,
      })),
    ),
  );
  const revoke = vi.fn(() => Effect.void);
  const write = vi.fn(() => Effect.void);
  const findByIdentifier = vi.fn((subject: string) => {
    const id = options.accounts?.[subject];
    return Effect.succeed(id === undefined || id === null ? null : { id });
  });

  const layer = Layer.mergeAll(
    Layer.succeed(ZitadelManagementTag, {
      searchEvents,
    } as unknown as typeof ZitadelManagementTag.Service),
    Layer.succeed(LifecycleCursorTag, {
      read: Effect.succeed(SINCE),
      write,
    }),
    Layer.succeed(SessionStoreTag, {
      listForUser,
      revoke,
    } as unknown as typeof SessionStoreTag.Service),
    Layer.succeed(AccountRepositoryTag, {
      findByIdentifier,
    } as unknown as typeof AccountRepositoryTag.Service),
  );

  return { layer, searchEvents, revoke, write, findByIdentifier };
};

const run = (layer: Layer.Layer<never, never, never>) =>
  Effect.runPromise(
    reconcileOnce.pipe(Effect.provide(layer)) as Effect.Effect<number>,
  );

const event = (subject: string, createdAt: string): Event => ({
  subject,
  type: 'user.deactivated',
  createdAt,
});

describe('reconcileOnce', () => {
  it('revokes the sessions every user an event names held when it happened', async () => {
    const w = wiring({
      events: [event('sub-1', '2026-09-11T01:00:00.000Z')],
      accounts: { 'sub-1': 'user-1' },
      sessions: {
        'user-1': [
          { id: 'before', createdAt: '2026-09-11T00:30:00.000Z' },
          { id: 'same-moment', createdAt: '2026-09-11T01:00:00.000Z' },
        ],
      },
    });

    const handled = await run(w.layer as Layer.Layer<never, never, never>);

    expect(handled).toBe(1);
    expect(w.revoke.mock.calls).toEqual([['before'], ['same-moment']]);
  });

  it('spares a session opened after the event, which a reactivation allowed (#433)', async () => {
    // The cursor re-reads a minute of events on every pass, so the same
    // deactivation arrives again after the user was reactivated and signed
    // back in. That new session is not one the deactivation applied to.
    const w = wiring({
      events: [event('sub-1', '2026-09-11T01:00:00.000Z')],
      accounts: { 'sub-1': 'user-1' },
      sessions: {
        'user-1': [{ id: 'after', createdAt: '2026-09-11T01:00:30.000Z' }],
      },
    });

    await run(w.layer as Layer.Layer<never, never, never>);

    expect(w.revoke).not.toHaveBeenCalled();
  });

  it('asks only for the lifecycle events, from the cursor', async () => {
    const w = wiring({ events: [] });

    await run(w.layer as Layer.Layer<never, never, never>);

    expect(w.searchEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        since: SINCE,
        eventTypes: ['user.deactivated', 'user.locked', 'user.removed'],
      }),
    );
  });

  it('advances the cursor to the newest event, never to the clock', async () => {
    // Stamping `now` would skip anything the instance recorded while this pass
    // was running — the same class of gap this whole mechanism exists to close.
    const w = wiring({
      events: [
        event('sub-1', '2026-09-11T01:00:00.000Z'),
        event('sub-2', '2026-09-11T02:00:00.000Z'),
      ],
      accounts: { 'sub-1': 'user-1', 'sub-2': 'user-2' },
    });

    await run(w.layer as Layer.Layer<never, never, never>);

    expect(w.write).toHaveBeenCalledWith('2026-09-11T02:00:00.000Z');
  });

  it('writes no cursor and revokes nothing when the provider has nothing', async () => {
    const w = wiring({ events: [] });

    const handled = await run(w.layer as Layer.Layer<never, never, never>);

    expect(handled).toBe(0);
    expect(w.write).not.toHaveBeenCalled();
    expect(w.revoke).not.toHaveBeenCalled();
  });

  it('skips a subject that maps to no account here', async () => {
    // A Zitadel user r10c never provisioned. Nothing to revoke, and the cursor
    // must still advance past it or the sweep reads it forever.
    const w = wiring({
      events: [event('stranger', '2026-09-11T03:00:00.000Z')],
      accounts: {},
    });

    await run(w.layer as Layer.Layer<never, never, never>);

    expect(w.revoke).not.toHaveBeenCalled();
    expect(w.write).toHaveBeenCalledWith('2026-09-11T03:00:00.000Z');
  });
});
