import {
  defineSaga,
  type SagaDefinition,
  type SagaDispatch,
  SagaDispatcherTag,
  type SagaInstance,
  type SagaStore,
} from '@r10c/entifix-transactions';
import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect, HashMap, Layer, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import { resumeStaleSagas } from './resume';

const STALE_AFTER_MS = 60_000;
const MAX_RESUME_ATTEMPTS = 3;

const checkout = defineSaga({
  name: 'checkout',
  permission: 'order-management:product-order:write',
  steps: [
    {
      id: 'reserve',
      participant: 'stock-service',
      command: { method: 'POST', path: '/api/reservation' },
      compensation: {
        method: 'DELETE',
        path: '/api/reservation/{outcome.data.id}',
      },
      kind: 'compensatable',
      fanOut: true,
    },
    {
      id: 'write-order',
      participant: 'order-service',
      command: { method: 'POST', path: '/api/product-order' },
      compensation: {
        method: 'DELETE',
        path: '/api/product-order/{outcome.data.id}',
      },
      kind: 'compensatable',
    },
  ],
});

const SAGAS: Readonly<Record<string, SagaDefinition>> = { checkout };

const anInstance = (fields: Partial<SagaInstance> = {}): SagaInstance => ({
  sagaId: 'saga-1',
  definition: 'checkout',
  state: 'RUNNING',
  stepIndex: 0,
  outcomes: [],
  inputs: { reserve: [{ body: { lineId: 'l-1' }, organizationId: 'org-a' }] },
  resumeAttempts: 0,
  createdAt: '2026-09-09T00:00:00.000Z',
  updatedAt: '2026-09-09T00:00:00.000Z',
  ...fields,
});

/**
 * A store that records what the pass did, and whose claim can be made to fail
 * the way a lost race fails.
 */
const recordingStore = (
  stale: readonly SagaInstance[],
  options: { readonly claimable?: boolean } = {},
) => {
  const claimed: string[] = [];
  const settled: Array<{ state: string; error?: string }> = [];

  const store: SagaStore = {
    start: () => Effect.void,
    beginStep: () => Effect.void,
    recordOutcome: () => Effect.void,
    settle: (_sagaId, state, error) =>
      Effect.sync(() => {
        settled.push({ state, error });
      }),
    get: () => Effect.succeed(undefined),
    findStale: () => Effect.succeed(stale),
    claimForResume: sagaId =>
      Effect.sync(() => {
        if (options.claimable === false) {
          return undefined;
        }
        claimed.push(sagaId);
        const found = stale.find(instance => instance.sagaId === sagaId);
        return found
          ? { ...found, resumeAttempts: found.resumeAttempts + 1 }
          : undefined;
      }),
    markCompensated: () => Effect.void,
  };

  return { store, claimed, settled };
};

/** A dispatcher that answers every call the same way, and records them. */
const dispatcher = (ok: boolean) => {
  const dispatched: SagaDispatch[] = [];
  const layer = Layer.succeed(SagaDispatcherTag, {
    dispatch: (dispatch: SagaDispatch) =>
      Effect.sync(() => {
        dispatched.push(dispatch);
        return { ok, status: ok ? 201 : 409, body: { data: { id: 'x-1' } } };
      }),
  });
  return { layer, dispatched };
};

const runPass = async (
  store: SagaStore,
  layer: Layer.Layer<SagaDispatcherTag>,
) => {
  const logs: Array<{
    message: string;
    level: string;
    annotations: Record<string, unknown>;
  }> = [];

  await Effect.runPromise(
    resumeStaleSagas(
      store,
      SAGAS,
      STALE_AFTER_MS,
      MAX_RESUME_ATTEMPTS,
    ).pipe(
      Effect.provide(layer),
      Effect.provide(
        Logger.replace(
          Logger.defaultLogger,
          Logger.make(({ logLevel, message, annotations }) => {
            logs.push({
              message: String(message),
              level: logLevel.label,
              annotations: Object.fromEntries(HashMap.toEntries(annotations)),
            });
          }),
        ),
      ),
    ),
  );

  return logs;
};

describe('resumeStaleSagas', () => {
  it('claims each stale instance and finishes the flow', async () => {
    const { store, claimed, settled } = recordingStore([anInstance()]);
    const { layer, dispatched } = dispatcher(true);

    const logs = await runPass(store, layer);

    expect(claimed).toEqual(['saga-1']);
    expect(dispatched.map(d => d.commandId)).toEqual([
      'saga-1:reserve:0',
      'saga-1:write-order',
    ]);
    expect(settled).toEqual([{ state: 'COMPLETED', error: undefined }]);
    expect(
      logs.some(line => line.message === 'resumed a saga instance'),
    ).toBe(true);
  });

  /**
   * ⚠️ The multi-replica case. `claimForResume` is a conditional write, so the
   * sweeper that loses the race gets `undefined` — and must dispatch nothing at
   * all rather than resuming a flow another process is already walking.
   */
  it('dispatches nothing for an instance another sweeper claimed', async () => {
    const { store, settled } = recordingStore([anInstance()], {
      claimable: false,
    });
    const { layer, dispatched } = dispatcher(true);

    await runPass(store, layer);

    expect(dispatched).toEqual([]);
    expect(settled).toEqual([]);
  });

  /**
   * A flow this process has no definition for cannot be finished here, and
   * settling it would be a guess about steps that cannot be read. Surfaced and
   * left alone.
   */
  it('surfaces a stale instance naming an unknown definition', async () => {
    const { store, claimed } = recordingStore([
      anInstance({ definition: 'refund' }),
    ]);
    const { layer, dispatched } = dispatcher(true);

    const logs = await runPass(store, layer);

    expect(claimed).toEqual([]);
    expect(dispatched).toEqual([]);
    expect(
      logs.find(
        line => line.message === 'stale saga names an unknown definition',
      ),
    ).toMatchObject({ level: 'ERROR', annotations: { definition: 'refund' } });
  });

  /**
   * ⚠️ Never fails. A daemon whose pass propagates an error stops sweeping, and
   * the fleet then silently resumes nothing until someone restarts the process.
   */
  it('logs and survives a store that cannot be read', async () => {
    const failing: SagaStore = {
      ...recordingStore([]).store,
      findStale: () => Effect.fail(new EntifixConnError('mongo is gone')),
    };
    const { layer } = dispatcher(true);

    const logs = await runPass(failing, layer);

    expect(
      logs.find(line => line.message === 'saga resume sweep failed'),
    ).toMatchObject({ level: 'ERROR' });
  });

  /** One instance that cannot be resumed must not abandon the ones behind it. */
  it('keeps going when one instance fails to resume', async () => {
    const instances = [
      anInstance({ sagaId: 'saga-1' }),
      anInstance({ sagaId: 'saga-2' }),
    ];
    const { store } = recordingStore(instances);
    const broken: SagaStore = {
      ...store,
      beginStep: sagaId =>
        sagaId === 'saga-1'
          ? Effect.fail(new EntifixConnError('write failed'))
          : Effect.void,
    };
    const { layer, dispatched } = dispatcher(true);

    const logs = await runPass(broken, layer);

    expect(
      logs.find(line => line.message === 'resuming a saga instance failed'),
    ).toMatchObject({ level: 'ERROR', annotations: { sagaId: 'saga-1' } });
    // The second instance still ran every one of its steps.
    expect(dispatched.map(d => d.commandId)).toEqual([
      'saga-2:reserve:0',
      'saga-2:write-order',
    ]);
  });
});
