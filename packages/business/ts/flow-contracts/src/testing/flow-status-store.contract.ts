import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { FlowStatusRecord, FlowStatusStore } from '../flow-status.js';

/** A record at `version`, with every optional member present. */
export const contractFlowStatus = (
  flowId: string,
  version: number,
  overrides: Partial<FlowStatusRecord> = {},
): FlowStatusRecord => ({
  flowId,
  definition: 'checkout',
  slipVersion: 1,
  state: 'running',
  step: `step-${version}`,
  audience: [{ kind: 'organization', id: 'org-a' }],
  version,
  updatedAt: new Date(Date.UTC(2026, 10, 3, 0, 0, version)),
  ...overrides,
});

/**
 * The behaviour every `FlowStatusStore` owes its callers
 * ([ADR 0063](../../../../../../docs/adr/0063-a-cell-reaches-full-coverage-through-fakes-and-contract-suites.md)).
 * `make` returns a fresh, empty store and a way to run against it.
 */
export const describeFlowStatusStoreContract = (
  name: string,
  make: () => {
    readonly run: <A, E>(
      use: (store: FlowStatusStore) => Effect.Effect<A, E>,
    ) => Promise<A>;
  },
) => {
  describe(`${name} — the FlowStatusStore contract`, () => {
    it('reads back what it applied, and nothing for a flow it never saw', async () => {
      const { run } = make();
      const record = contractFlowStatus('f-1', 1, {
        failure: { code: 'paymentDeclined', category: 'refused' },
        capabilityDigest: 'digest-1',
        audience: [
          { kind: 'organization', id: 'org-a' },
          { kind: 'flow', id: 'f-1', digest: 'digest-1' },
        ],
      });

      expect(
        await run(store =>
          store.apply(record, { consumer: 'c', eventId: 'e-1' }),
        ),
      ).toBe('applied');
      expect(await run(store => store.read('f-1'))).toEqual(record);
      expect(await run(store => store.read('f-404'))).toBeUndefined();
    });

    it('answers a redelivered message as a duplicate and keeps one record', async () => {
      const { run } = make();
      const record = contractFlowStatus('f-2', 3, { state: 'completed' });
      const claim = { consumer: 'c', eventId: 'f-2:flow.completed' };

      expect(await run(store => store.apply(record, claim))).toBe('applied');
      expect(await run(store => store.apply(record, claim))).toBe('duplicate');
      expect(await run(store => store.readMany(['f-2']))).toEqual([record]);
    });

    it('never lets an older version overwrite a newer one', async () => {
      const { run } = make();
      const newer = contractFlowStatus('f-3', 4, { state: 'completed' });
      const older = contractFlowStatus('f-3', 2, { state: 'running' });

      await run(store => store.apply(newer, { consumer: 'c', eventId: 'e-4' }));

      expect(
        await run(store =>
          store.apply(older, { consumer: 'c', eventId: 'e-2' }),
        ),
      ).toBe('stale');
      expect((await run(store => store.read('f-3')))?.state).toBe('completed');
    });

    it('treats an equal version under a different message as stale', async () => {
      const { run } = make();
      const record = contractFlowStatus('f-4', 2);

      await run(store => store.apply(record, { consumer: 'c', eventId: 'a' }));

      expect(
        await run(store =>
          store.apply(
            { ...record, state: 'failed' },
            { consumer: 'c', eventId: 'b' },
          ),
        ),
      ).toBe('stale');
    });

    it('advances to a newer version', async () => {
      const { run } = make();

      await run(store =>
        store.apply(contractFlowStatus('f-5', 1), {
          consumer: 'c',
          eventId: '1',
        }),
      );
      await run(store =>
        store.apply(contractFlowStatus('f-5', 2, { state: 'completed' }), {
          consumer: 'c',
          eventId: '2',
        }),
      );

      expect((await run(store => store.read('f-5')))?.version).toBe(2);
    });

    it('reads many, returning only the flows it holds', async () => {
      const { run } = make();
      await run(store =>
        Effect.all([
          store.apply(contractFlowStatus('f-6', 1), {
            consumer: 'c',
            eventId: 'x',
          }),
          store.apply(contractFlowStatus('f-7', 1), {
            consumer: 'c',
            eventId: 'y',
          }),
        ]),
      );

      const many = await run(store => store.readMany(['f-6', 'f-404', 'f-7']));

      expect(many.map(record => record.flowId).sort()).toEqual(['f-6', 'f-7']);
      expect(await run(store => store.readMany([]))).toEqual([]);
    });
  });
};
