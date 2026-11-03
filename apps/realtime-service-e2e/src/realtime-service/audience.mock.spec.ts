import '@r10c/business-ts-order-contracts';
import '@r10c/business-ts-catalog-contracts';

import type { DomainEvent } from '@entifix/core';
import type { RunningTestService } from '@entifix/service-shell/testing';
import { digestFlowCapability } from '@entifix/transactions';
import { ENTITY_CHANGED } from '@r10c/business-ts-flow-contracts';
import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MOCK_BUS, startMockService } from '../support/mock-service';
import {
  has,
  type Listener,
  openStream,
  QUIET_MS,
  tokenFor,
} from '../support/stream';

/**
 * Who hears what (ADR 0072). The stream route, the projections and the
 * audience filter are the service's own; what is replaced is the broker, so a
 * spec delivers a message the way a broadcast queue would.
 */
let running: RunningTestService | undefined;
const listeners: Listener[] = [];

beforeAll(async () => {
  running = await startMockService();
});

afterAll(async () => {
  for (const listener of listeners) listener.close();
  await running?.close();
});

const open = async (query: string, headers?: Record<string, string>) => {
  const listener = await openStream(running?.baseUrl ?? '', query, headers);
  listeners.push(listener);
  return listener;
};

const asMember = async (
  organizationId: string,
  roles: readonly string[] = ['user'],
) => ({
  authorization: `Bearer ${await tokenFor({ roles, organizationId })}`,
});

const deliver = (event: DomainEvent) =>
  Effect.runPromise(MOCK_BUS.deliver(event));

const placed = (id: string, organizationId = 'org-a'): DomainEvent => ({
  name: 'order.placed',
  id,
  source: 'order',
  at: '2026-11-03T00:00:00.000Z',
  aggregate: { type: 'product-order', id: 'o-1' },
  version: 1,
  audience: [{ kind: 'organization', id: organizationId }],
  data: {
    id: 'o-1',
    items: [
      { vendorId: organizationId, amount: 10, quantity: 1, currency: 'GTQ' },
    ],
  },
});

describe('the audience filter', () => {
  it('never delivers organization A’s event to a connection of organization B', async () => {
    const a = await open('topic=entity:product-order', await asMember('org-a'));
    const b = await open('topic=entity:product-order', await asMember('org-b'));
    const event = placed('order.placed:isolation');
    await deliver(event);

    expect(await a.until(has(event.id))).toContain(event.id);
    expect(await b.until(has(event.id), QUIET_MS)).not.toContain(event.id);
  });

  it('delivers an event naming no audience to nobody', async () => {
    const a = await open('topic=entity:product-order', await asMember('org-a'));
    const unaddressed = placed('order.placed:unaddressed');
    delete unaddressed.audience;
    await deliver(unaddressed);

    expect(await a.until(has(unaddressed.id), QUIET_MS)).not.toContain(
      unaddressed.id,
    );
  });

  it('delivers a flow outcome only to the holder of the matching capability', async () => {
    const nonce = 'e2e-capability';
    const digest = await Effect.runPromise(digestFlowCapability(nonce));
    const holder = await open(`topic=flow:f-1&capability=${nonce}`);
    const stranger = await open('topic=flow:f-1&capability=not-the-nonce');
    const completed: DomainEvent = {
      name: 'flow.completed',
      id: 'f-1:flow.completed:completed',
      source: 'transaction',
      at: '2026-11-03T00:00:00.000Z',
      aggregate: { type: 'flow', id: 'f-1' },
      version: 2,
      audience: [{ kind: 'flow', id: 'f-1', digest }],
      data: { flowId: 'f-1', definition: 'checkout', slipVersion: 1 },
    };
    await deliver(completed);

    expect(await holder.until(has(completed.id))).toContain(completed.id);
    expect(await stranger.until(has(completed.id), QUIET_MS)).not.toContain(
      completed.id,
    );
  });
});

describe('what an admitted member hears', () => {
  it('is the record with the read grant, and a hint without it', async () => {
    const reader = await open(
      'topic=record:product-order:o-1',
      await asMember('org-a', ['user']),
    );
    const nonReader = await open(
      'topic=record:product-order:o-1',
      await asMember('org-a', []),
    );
    const event = placed('order.placed:grants');
    await deliver(event);

    const snapshot = await reader.until(has(event.id));
    const hint = await nonReader.until(has(event.id));

    expect(snapshot).toContain('"name":"order.placed"');
    expect(hint).toContain(`"name":"${ENTITY_CHANGED}"`);
    expect(hint).not.toContain('"items"');
  });
});

describe('the stream itself', () => {
  it('refuses a caller with no session and no capability before it opens', async () => {
    const anonymous = await open('topic=entity:product-order');

    expect(anonymous.status).toBe(401);
  });

  it('asks to reauthenticate before the token expires', async () => {
    const token = await tokenFor({
      roles: ['user'],
      organizationId: 'org-a',
      ttlSeconds: 1,
    });
    const stream = await open('topic=entity:product-order', {
      authorization: `Bearer ${token}`,
    });

    expect(await stream.until(has('event: reauth'), 3000)).toContain(
      'event: reauth',
    );
  });
});
