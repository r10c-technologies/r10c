import { Effect } from 'effect';

import type {
  FlowStatusApplied,
  FlowStatusRecord,
  FlowStatusStore,
} from '../flow-status.js';

/**
 * The `flow-status` store as a map, for specs above the cell. It answers the
 * contract the Mongo cell answers: a claimed message is a duplicate, and a
 * version at or below the stored one is stale.
 */
export const makeInMemoryFlowStatusStore = (): FlowStatusStore & {
  readonly records: () => readonly FlowStatusRecord[];
} => {
  const records = new Map<string, FlowStatusRecord>();
  const claimed = new Set<string>();
  return {
    records: () => Array.from(records.values()),
    read: flowId => Effect.sync(() => records.get(flowId)),
    readMany: flowIds =>
      Effect.sync(() =>
        flowIds.flatMap(flowId => {
          const record = records.get(flowId);
          return record === undefined ? [] : [record];
        }),
      ),
    apply: (record, claim) =>
      Effect.sync((): FlowStatusApplied => {
        const key = `${claim.consumer}\u0000${claim.eventId}`;
        if (claimed.has(key)) return 'duplicate';
        claimed.add(key);
        const current = records.get(record.flowId);
        if (current !== undefined && current.version >= record.version)
          return 'stale';
        records.set(record.flowId, record);
        return 'applied';
      }),
  };
};
