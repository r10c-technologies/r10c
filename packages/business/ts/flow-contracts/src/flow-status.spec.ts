import '@entifix/transactions';

import type { DomainEvent } from '@entifix/core';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  admitsFlowReader,
  flowStatusFromEvent,
  type FlowStatusStore,
  toFlowStatusBody,
} from './index.js';
import {
  contractFlowStatus,
  describeFlowStatusStoreContract,
  makeInMemoryFlowStatusStore,
} from './testing/index.js';

const flowEvent = (overrides: Partial<DomainEvent> = {}): DomainEvent => ({
  name: 'flow.failed',
  id: 'f-1:flow.failed:failed',
  source: 'transaction',
  at: '2026-11-03T00:00:05.000Z',
  aggregate: { type: 'flow', id: 'f-1' },
  version: 4,
  audience: [
    { kind: 'flow', id: 'f-1' },
    { kind: 'flow', id: 'f-1', digest: 'digest-1' },
    { kind: 'organization', id: 'org-a' },
  ],
  data: {
    flowId: 'f-1',
    definition: 'checkout',
    slipVersion: 2,
    step: 'flow.failed:failed',
    failure: { code: 'paymentDeclined', category: 'refused' },
  },
  ...overrides,
});

describe('flowStatusFromEvent', () => {
  it('projects a flow event, reading the digest off the audience', async () => {
    const record = await Effect.runPromise(flowStatusFromEvent(flowEvent()));

    expect(record).toEqual({
      flowId: 'f-1',
      definition: 'checkout',
      slipVersion: 2,
      state: 'failed',
      step: 'flow.failed:failed',
      failure: { code: 'paymentDeclined', category: 'refused' },
      audience: flowEvent().audience,
      capabilityDigest: 'digest-1',
      version: 4,
      updatedAt: new Date('2026-11-03T00:00:05.000Z'),
    });
  });

  it('maps every flow event name to a state', async () => {
    for (const [name, state] of [
      ['flow.started', 'running'],
      ['flow.suspended', 'suspended'],
      ['flow.completed', 'completed'],
      ['flow.stranded', 'stranded'],
    ] as const) {
      const record = await Effect.runPromise(
        flowStatusFromEvent(
          flowEvent({
            name,
            audience: [{ kind: 'organization', id: 'org-a' }],
            data: { flowId: 'f-1', definition: 'checkout', slipVersion: 1 },
          }),
        ),
      );
      expect(record.state).toBe(state);
      expect(record).not.toHaveProperty('capabilityDigest');
      expect(record).not.toHaveProperty('step');
      expect(record).not.toHaveProperty('failure');
    }
  });

  it('holds an event with no audience to an empty one', async () => {
    const event = flowEvent();
    delete event.audience;

    expect(
      (await Effect.runPromise(flowStatusFromEvent(event))).audience,
    ).toEqual([]);
  });

  const unversioned = flowEvent();
  delete unversioned.version;

  it.each([
    ['a name that is not a flow event', flowEvent({ name: 'order.placed' })],
    ['no version', unversioned],
    ['data that is not a flow event', flowEvent({ data: { flowId: 1 } })],
  ])('refuses %s', async (_label, event) => {
    expect(
      Exit.isFailure(await Effect.runPromiseExit(flowStatusFromEvent(event))),
    ).toBe(true);
  });
});

describe('admitsFlowReader', () => {
  const record = contractFlowStatus('f-1', 1, {
    audience: [
      { kind: 'organization', id: 'org-a' },
      { kind: 'party', id: 'party-1' },
      { kind: 'flow', id: 'f-1', digest: 'digest-1' },
    ],
  });

  it('admits the organization, the party and the capability holder', () => {
    expect(admitsFlowReader(record, { organizationId: 'org-a' })).toBe(true);
    expect(admitsFlowReader(record, { partyId: 'party-1' })).toBe(true);
    expect(admitsFlowReader(record, { flowDigests: ['digest-1'] })).toBe(true);
  });

  it('refuses everyone else, and everyone for a record with no audience', () => {
    expect(admitsFlowReader(record, { organizationId: 'org-b' })).toBe(false);
    expect(admitsFlowReader(record, { flowDigests: ['other'] })).toBe(false);
    expect(
      admitsFlowReader(
        { ...record, audience: [] },
        { organizationId: 'org-a' },
      ),
    ).toBe(false);
  });
});

describe('toFlowStatusBody', () => {
  it('answers the state, the step and the failure, and nothing about who may read it', () => {
    expect(
      toFlowStatusBody(
        contractFlowStatus('f-1', 1, {
          state: 'failed',
          failure: { code: 'paymentDeclined', category: 'refused' },
          capabilityDigest: 'digest-1',
        }),
      ),
    ).toEqual({
      flowId: 'f-1',
      state: 'failed',
      step: 'step-1',
      failure: { code: 'paymentDeclined', category: 'refused' },
    });
    const bare = { ...contractFlowStatus('f-2', 1) };
    delete (bare as { step?: string }).step;
    expect(toFlowStatusBody(bare)).toEqual({ flowId: 'f-2', state: 'running' });
  });
});

describeFlowStatusStoreContract('the in-memory double', () => {
  const store = makeInMemoryFlowStatusStore();
  return {
    run: <A, E>(use: (port: FlowStatusStore) => Effect.Effect<A, E>) =>
      Effect.runPromise(use(store)) as Promise<A>,
  };
});

describe('the in-memory double', () => {
  it('lists what it holds', async () => {
    const store = makeInMemoryFlowStatusStore();
    await Effect.runPromise(
      store.apply(contractFlowStatus('f-1', 1), {
        consumer: 'c',
        eventId: 'e',
      }),
    );

    expect(store.records().map(record => record.flowId)).toEqual(['f-1']);
  });
});
