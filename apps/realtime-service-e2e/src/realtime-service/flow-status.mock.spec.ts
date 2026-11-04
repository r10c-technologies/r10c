import type { DomainEvent } from '@entifix/core';
import type { RunningTestService } from '@entifix/service-shell/testing';
import { digestFlowCapability } from '@entifix/transactions';
import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  MOCK_BUS,
  MOCK_FLOW_STATUS,
  startMockService,
} from '../support/mock-service';
import { tokenFor } from '../support/stream';

/**
 * Where a flow stands (ADR 0072, ADR 0073): the projection written from
 * `flow.*`, and the reads a pending write catches up from. A miss of any kind
 * is `404`, which the browser reads as still pending.
 */
let running: RunningTestService | undefined;

beforeAll(async () => {
  running = await startMockService();
});

afterAll(async () => {
  await running?.close();
});

const NONCE = 'e2e-flow-capability';

const flowEvent = (
  name: string,
  flowId: string,
  version: number,
  audience: DomainEvent['audience'],
): DomainEvent => ({
  name,
  id: `${flowId}:${name}:${version}`,
  source: 'transaction',
  at: '2026-11-03T00:00:00.000Z',
  aggregate: { type: 'flow', id: flowId },
  version,
  ...(audience === undefined ? {} : { audience }),
  data: {
    flowId,
    definition: 'checkout',
    slipVersion: 1,
    ...(name === 'flow.failed'
      ? { failure: { code: 'paymentDeclined', category: 'refused' } }
      : {}),
  },
});

const deliver = (event: DomainEvent) =>
  Effect.runPromise(MOCK_BUS.deliver(event));

const read = async (path: string, organizationId?: string) =>
  fetch(`${running?.baseUrl}/api/realtime/flow${path}`, {
    headers:
      organizationId === undefined
        ? {}
        : {
            authorization: `Bearer ${await tokenFor({ roles: ['user'], organizationId })}`,
          },
  });

describe('the flow-status projection', () => {
  it('leaves one record when one flow.completed is delivered twice', async () => {
    const completed = flowEvent('flow.completed', 'f-twice', 3, [
      { kind: 'organization', id: 'org-a' },
    ]);
    await deliver(completed);
    await deliver(completed);

    expect(
      MOCK_FLOW_STATUS.records().filter(record => record.flowId === 'f-twice'),
    ).toHaveLength(1);
  });

  it('never lets an older version overwrite a newer one', async () => {
    const audience = [{ kind: 'organization' as const, id: 'org-a' }];
    await deliver(flowEvent('flow.failed', 'f-order', 4, audience));
    await deliver(flowEvent('flow.started', 'f-order', 0, audience));

    const response = await read('/f-order', 'org-a');
    expect(((await response.json()) as { data: unknown }).data).toMatchObject({
      state: 'failed',
      failure: { code: 'paymentDeclined' },
    });
  });
});

describe('the catch-up reads', () => {
  beforeAll(async () => {
    const digest = await Effect.runPromise(digestFlowCapability(NONCE));
    await deliver(
      flowEvent('flow.completed', 'f-read', 2, [
        { kind: 'flow', id: 'f-read' },
        { kind: 'flow', id: 'f-read', digest },
        { kind: 'organization', id: 'org-a' },
      ]),
    );
  });

  it('answers the flow’s organization with its status envelope', async () => {
    const response = await read('/f-read', 'org-a');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      meta: { type: 'flowStatus', entity: 'flow' },
      data: { flowId: 'f-read', state: 'completed' },
    });
  });

  it('answers the capability holder with no session', async () => {
    expect((await read(`/f-read?capability=${NONCE}`)).status).toBe(200);
  });

  it('answers a member of another organization with 404', async () => {
    expect((await read('/f-read', 'org-b')).status).toBe(404);
  });

  it('answers a capability that does not hash to the digest with 404', async () => {
    expect((await read('/f-read?capability=not-it')).status).toBe(404);
  });

  it('answers a flow not yet projected exactly as a foreign one', async () => {
    expect((await read('/f-not-yet', 'org-a')).status).toBe(404);
  });

  it('lists only what the caller may read', async () => {
    const response = await read('?ids=f-read,f-not-yet', 'org-a');

    expect(((await response.json()) as { data: unknown }).data).toEqual([
      { flowId: 'f-read', state: 'completed' },
    ]);
    expect(
      ((await (await read('?ids=f-read', 'org-b')).json()) as { data: unknown })
        .data,
    ).toEqual([]);
  });
});
