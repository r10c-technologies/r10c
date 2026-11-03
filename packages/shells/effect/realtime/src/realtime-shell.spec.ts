import '@r10c/business-ts-order-contracts';
import '@r10c/business-ts-catalog-contracts';
import '@entifix/transactions';

import { makeStaticPolicyDecision, PolicyDecisionTag } from '@entifix/authz';
import {
  InvalidToken,
  type TokenClaims,
  TokenServiceTag,
} from '@entifix/business';
import type { DomainEvent } from '@entifix/core';
import type { PushConnection } from '@entifix/service-shell/push';
import {
  type RunningTestService,
  serveTestService,
} from '@entifix/service-shell/testing';
import { makeRecordingEventBus } from '@entifix/testing-unit';
import { digestFlowCapability, EventBusTag } from '@entifix/transactions';
import { ROLE_PERMISSIONS } from '@r10c/business-ts-authz-grants';
import { ENTITY_CHANGED } from '@r10c/business-ts-flow-contracts';
import {
  configurationRows,
  fleetConfigurationOf,
} from '@r10c/shells-effect-service';
import { Effect, Layer, Stream } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  admitsVariant,
  makeAppLayer,
  makeRealtimePush,
  MAX_TOPICS,
  PUSH_PROJECTIONS,
  type Pushed,
  readPushDials,
  realtimeComposition,
  RealtimePushLayer,
  routedTopics,
  startPushSubscriptions,
  STREAM_PATH,
  streamRoutes,
} from './index.js';

const CONFIGURATION = fleetConfigurationOf({
  jwt: configurationRows({ publicKey: 'unused', keyId: 'spec-key' }),
  mongo: configurationRows({
    uri: 'mongodb://127.0.0.1:1/?directConnection=true',
    db: 'flow_status',
  }),
  rabbitmq: configurationRows({ uri: 'amqp://127.0.0.1:1' }),
  realtime: configurationRows({
    retryMinMs: 10,
    retryMaxMs: 20,
    reauthMarginMs: 0,
    drainWindowMs: 100,
  }),
});

const order = (overrides: Partial<DomainEvent> = {}): DomainEvent => ({
  name: 'order.placed',
  id: 'order.placed:o-1:1',
  source: 'order',
  at: '2026-11-03T00:00:00.000Z',
  aggregate: { type: 'product-order', id: 'o-1' },
  version: 1,
  audience: [{ kind: 'organization', id: 'org-a' }],
  data: {
    id: 'o-1',
    items: [{ vendorId: 'org-a', amount: 10, quantity: 1, currency: 'GTQ' }],
  },
  ...overrides,
});

const published: DomainEvent = {
  name: 'catalog.published',
  id: 'catalog.published:off-1:1',
  source: 'marketplace-admin',
  at: '2026-11-03T00:00:00.000Z',
  aggregate: { type: 'product-offering', id: 'off-1' },
  version: 1,
  audience: [{ kind: 'organization', id: 'org-a' }],
  data: {},
};

const flowCompleted = (
  flowId: string,
  audience: DomainEvent['audience'],
): DomainEvent => ({
  name: 'flow.completed',
  id: `${flowId}:flow.completed:completed`,
  source: 'transaction',
  at: '2026-11-03T00:00:00.000Z',
  correlationId: flowId,
  aggregate: { type: 'flow', id: flowId },
  version: 3,
  ...(audience === undefined ? {} : { audience }),
  data: {
    flowId,
    definition: 'checkout',
    slipVersion: 1,
    step: 'flow.completed:completed',
  },
});

describe('the push projections', () => {
  it('push an order as the record to readers and a hint to everyone else', () => {
    const [snapshot, hint] = PUSH_PROJECTIONS['order.placed']?.(order()) ?? [];

    expect(snapshot?.gate).toEqual({ to: 'readers', entity: 'product-order' });
    expect(snapshot?.event.name).toBe('order.placed');
    expect(hint?.gate).toEqual({ to: 'nonReaders', entity: 'product-order' });
    expect(hint?.event).toMatchObject({
      name: ENTITY_CHANGED,
      data: { entity: 'product-order', change: 'created', id: 'o-1' },
    });
    expect(snapshot?.topics).toEqual([
      'entity:product-order',
      'record:product-order:o-1',
    ]);
  });

  it('push a publication as a hint to every member, never as the record', () => {
    const pushed = PUSH_PROJECTIONS['catalog.published']?.(published) ?? [];

    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.gate).toEqual({ to: 'all' });
    expect(pushed[0]?.event.name).toBe(ENTITY_CHANGED);
  });

  it('push a flow outcome on its flow topic', () => {
    const pushed =
      PUSH_PROJECTIONS['flow.completed']?.(flowCompleted('f-1', [])) ?? [];

    expect(pushed[0]?.topics).toEqual(['flow:f-1']);
  });

  it('push nothing for an event that names no aggregate', () => {
    const bare = order();
    delete bare.aggregate;
    for (const name of ['order.cancelled', 'catalog.unpublished', 'flow.failed'])
      expect(PUSH_PROJECTIONS[name]?.(bare)).toEqual([]);
  });
});

describe('admitsVariant', () => {
  const connection = (
    readable?: readonly string[],
  ): PushConnection & { readable?: ReadonlySet<string> } => ({
    recipient: { organizationId: 'org-a' },
    topics: [],
    ...(readable === undefined ? {} : { readable: new Set(readable) }),
  });
  const [snapshot, hint] = PUSH_PROJECTIONS['order.placed']?.(
    order(),
  ) as Pushed[];

  it('refuses an unrouted event and an audience that does not name the caller', () => {
    expect(admitsVariant(undefined, connection())).toBe(false);
    expect(
      admitsVariant(snapshot, {
        recipient: { organizationId: 'org-b' },
        topics: [],
      }),
    ).toBe(false);
  });

  it('gives a reader the record and not the hint', () => {
    expect(admitsVariant(snapshot, connection(['product-order']))).toBe(true);
    expect(admitsVariant(hint, connection(['product-order']))).toBe(false);
  });

  it('gives a non-reader, or a connection with no read set, the hint only', () => {
    for (const listener of [connection([]), connection()]) {
      expect(admitsVariant(snapshot, listener)).toBe(false);
      expect(admitsVariant(hint, listener)).toBe(true);
    }
  });
});

describe('makeRealtimePush', () => {
  it('routes nothing for an event it never projected', () => {
    expect(routedTopics(undefined)).toEqual([]);
  });

  it('publishes nothing for an event with no projection, under a table and resume of its own', async () => {
    const published = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const push = yield* makeRealtimePush({
            dials: { retryMs: { min: 1, max: 2 }, reauthMarginMs: 0 },
            resume: () => Stream.empty,
            projections: {},
          });
          yield* push.publish(order());
          return 'done';
        }),
      ),
    );

    expect(published).toBe('done');
  });
});

describe('the realtime composition', () => {
  it('reads its dials from configuration', async () => {
    expect(await Effect.runPromise(readPushDials(CONFIGURATION))).toEqual({
      retryMs: { min: 10, max: 20 },
      reauthMarginMs: 0,
      drainWindowMs: 100,
    });
  });

  it('composes without dialling anything', async () => {
    const layer = await Effect.runPromise(realtimeComposition(CONFIGURATION));

    expect(Layer.isLayer(layer)).toBe(true);
  });

  it('refuses a configuration with no dials, at boot', async () => {
    const exit = await Effect.runPromiseExit(
      realtimeComposition(
        fleetConfigurationOf({ ...CONFIGURATION.plain, realtime: [] }),
      ),
    );

    expect(exit._tag).toBe('Failure');
  });

  it('offers the booted composition as a layer', () => {
    expect(Layer.isLayer(makeAppLayer())).toBe(true);
  });
});

/**
 * A token is `org|party|role|exp`, so a spec reads who is calling at a glance.
 * An empty segment is an absent claim; `bad` fails verification.
 */
const tokenService = {
  sign: () => Effect.die('unused'),
  verify: (token: string) => {
    if (token === 'bad') return Effect.fail(new InvalidToken());
    const [org, party, role, exp] = token.split('|');
    const claims: TokenClaims = {
      userId: 'u-1',
      subject: 's-1',
      sessionId: 'sess-1',
      roles: role === undefined || role === '' ? [] : [role],
      ...(org === undefined || org === '' ? {} : { activeOrganizationId: org }),
      ...(party === undefined || party === '' ? {} : { partyId: party }),
      ...(exp === undefined || exp === '' ? {} : { exp: Number(exp) }),
    };
    return Effect.succeed(claims);
  },
};

describe('GET /api/realtime/stream', () => {
  const bus = makeRecordingEventBus();
  let running: RunningTestService | undefined;
  const open: AbortController[] = [];

  beforeAll(async () => {
    const push = RealtimePushLayer({
      dials: { retryMs: { min: 10, max: 20 }, reauthMarginMs: 0 },
    });
    running = await serveTestService({
      name: 'realtime-spec',
      port: 0,
      slices: ['realtime'],
      router: streamRoutes,
      appLayer: Layer.provideMerge(
        Layer.effectDiscard(startPushSubscriptions),
        Layer.mergeAll(
          push,
          Layer.succeed(EventBusTag, bus),
          Layer.succeed(TokenServiceTag, tokenService),
          Layer.succeed(
            PolicyDecisionTag,
            makeStaticPolicyDecision(ROLE_PERMISSIONS),
          ),
        ),
      ) as never,
    });
  });

  afterAll(async () => {
    for (const controller of open) controller.abort();
    await running?.close();
  });

  const call = (query: string, headers: Record<string, string> = {}) => {
    const controller = new AbortController();
    open.push(controller);
    return fetch(`${running?.baseUrl}${STREAM_PATH}?${query}`, {
      headers,
      signal: controller.signal,
    });
  };

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  const sleep = (ms: number) =>
    new Promise(resolve => {
      setTimeout(resolve, ms);
    });

  /**
   * Reads a stream in the background. `until` waits for the text so far to
   * satisfy a predicate, or for `ms` to pass, and returns the text either way.
   */
  const listen = (response: Response) => {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let text = '';
    void (async () => {
      for (;;) {
        const chunk = await reader?.read().catch(() => undefined);
        if (chunk === undefined || chunk.done) return;
        text += decoder.decode(chunk.value);
      }
    })();
    return {
      until: async (holds: (body: string) => boolean, ms = 2000) => {
        const deadline = Date.now() + ms;
        while (!holds(text) && Date.now() < deadline) await sleep(10);
        return text;
      },
      close: () => reader?.cancel().catch(() => undefined),
    };
  };

  const opened = (text: string) => text.includes(': open');

  /** Opens every stream, waits until each has started, then delivers. */
  const listening = async (responses: readonly Response[]) => {
    const listeners = responses.map(listen);
    for (const listener of listeners) await listener.until(opened);
    return listeners;
  };

  const deliver = async (...events: readonly DomainEvent[]) => {
    for (const event of events) await Effect.runPromise(bus.deliver(event));
  };

  const has = (needle: string) => (text: string) => text.includes(needle);

  /** How long a spec waits to be sure something did **not** arrive. */
  const QUIET_MS = 300;

  it('refuses a caller with neither a session nor a capability', async () => {
    const response = await call('topic=entity:product-order');

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'unauthenticated' });
  });

  it('refuses a token that does not verify', async () => {
    const response = await call('topic=entity:product-order', bearer('bad'));

    expect(response.status).toBe(401);
  });

  it.each([
    ['no topic', ''],
    ['an illegal topic', 'topic=everything'],
    [
      'too many topics',
      Array.from(
        { length: MAX_TOPICS + 1 },
        (_, index) => `topic=flow:${index}`,
      ).join('&'),
    ],
  ])('refuses %s', async (_label, query) => {
    const response = await call(query, bearer('org-a||user|'));

    expect(response.status).toBe(400);
  });

  it('opens a stream as server-sent events', async () => {
    const response = await call(
      'topic=entity:product-order',
      bearer('org-a||user|'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const [stream] = await listening([response]);
    expect(await stream?.until(opened)).toContain('retry: ');
    await stream?.close();
  });

  it('delivers an event to its organization and to no other', async () => {
    const [mine, theirs] = await Promise.all([
      call('topic=entity:product-order', bearer('org-a||user|')),
      call('topic=entity:product-order', bearer('org-b||user|')),
    ]);
    const [a, b] = await listening([mine, theirs]);
    const marker = order({ id: 'order.placed:o-1:org-a' });
    await deliver(marker);

    expect(await a?.until(has(marker.id))).toContain(`id: ${marker.id}`);
    expect(await b?.until(has(marker.id), QUIET_MS)).not.toContain(marker.id);
  });

  it('delivers an event with no audience to nobody', async () => {
    const response = await call(
      'topic=entity:product-offering',
      bearer('org-a||user|'),
    );
    const [stream] = await listening([response]);
    const unaddressed: DomainEvent = { ...published };
    delete unaddressed.audience;
    const addressed = { ...published, id: 'catalog.published:addressed' };
    await deliver(
      { ...unaddressed, id: 'catalog.published:unaddressed' },
      addressed,
    );
    const text = await stream?.until(has(addressed.id));

    expect(text).toContain(addressed.id);
    expect(text).not.toContain('catalog.published:unaddressed');
  });

  it('gives a member with the read grant the record, and one without it a hint', async () => {
    const [reader, nonReader] = await Promise.all([
      call('topic=record:product-order:o-1', bearer('org-a||user|')),
      call('topic=record:product-order:o-1', bearer('org-a|||')),
    ]);
    const [a, b] = await listening([reader, nonReader]);
    const event = order({ id: 'order.placed:o-1:grants' });
    await deliver(event);
    const snapshot = await a?.until(has(event.id));
    const hint = await b?.until(has(event.id));

    expect(snapshot).toContain('"name":"order.placed"');
    expect(snapshot).not.toContain(ENTITY_CHANGED);
    expect(hint).toContain(`"name":"${ENTITY_CHANGED}"`);
    expect(hint).not.toContain('"items"');
  });

  it('delivers a flow outcome only to the holder of its capability', async () => {
    const nonce = 'spec-capability-nonce';
    const digest = await Effect.runPromise(digestFlowCapability(nonce));
    const [holder, stranger] = await Promise.all([
      call(`topic=flow:f-cap&capability=${nonce}`),
      call('topic=flow:f-cap&capability=some-other-nonce'),
    ]);
    const [a, b] = await listening([holder, stranger]);
    const event = flowCompleted('f-cap', [
      { kind: 'flow', id: 'f-cap', digest },
    ]);
    await deliver(event);

    expect(await a?.until(has(event.id))).toContain(event.id);
    expect(await b?.until(has(event.id), QUIET_MS)).not.toContain(event.id);
  });

  it('delivers a party-addressed event to that party', async () => {
    const response = await call('topic=flow:f-party', bearer('|party-1||'));
    const [stream] = await listening([response]);
    const event = flowCompleted('f-party', [{ kind: 'party', id: 'party-1' }]);
    await deliver(event);

    expect(await stream?.until(has(event.id))).toContain(event.id);
  });

  it('resyncs a reopened stream from its cursor, by query or by header', async () => {
    const [byQuery, byHeader] = await Promise.all([
      call(
        'topic=entity:product-order&lastEventId=evt-1',
        bearer('org-a||user|'),
      ),
      call('topic=entity:product-order', {
        ...bearer('org-a||user|'),
        'last-event-id': 'evt-1',
      }),
    ]);

    for (const stream of [listen(byQuery), listen(byHeader)])
      expect(await stream.until(has('event: resync'))).toContain(
        'event: resync',
      );
  });

  it('asks the stream to reauthenticate before its token expires', async () => {
    const exp = Math.floor(Date.now() / 1000) + 1;
    const response = await call(
      'topic=entity:product-order',
      bearer(`org-a||user|${exp}`),
    );

    expect(await listen(response).until(has('event: reauth'), 3000)).toContain(
      'event: reauth',
    );
  });
});
