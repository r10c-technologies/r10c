import { EntifixConnError } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { SagaInputs, SagaStarter } from '../saga-starter.js';

/**
 * How the coordinator behind a subject answers: a status and a body for each
 * start, or `undefined` for a coordinator that cannot be reached at all.
 */
export type CoordinatorScript = (
  definition: string,
  inputs: SagaInputs,
) => { readonly status: number; readonly body: unknown } | undefined;

const INPUTS: SagaInputs = {
  reserve: [{ organizationId: 'acme', body: { offeringId: 'o-1' } }],
};

/**
 * What every {@link SagaStarter} must guarantee: it hands the coordinator the
 * definition and the inputs it was given, and reads the answer the same way
 * whichever caller started the flow — `201` completed, `409` compensated,
 * anything else failed with its status, and a coordinator it cannot reach a
 * connection error rather than a failed flow.
 *
 * `make` returns a subject whose coordinator answers as `coordinator` says.
 */
export const describeSagaStarterContract = (
  name: string,
  make: (coordinator: CoordinatorScript) => SagaStarter | Promise<SagaStarter>,
) => {
  describe(`${name} honours the SagaStarter contract`, () => {
    const startWith = async (answer: ReturnType<CoordinatorScript>) => {
      const seen: { definition: string; inputs: SagaInputs }[] = [];
      const starter = await make((definition, inputs) => {
        seen.push({ definition, inputs });
        return answer;
      });
      const outcome = await Effect.runPromise(
        Effect.result(starter.start('checkout', INPUTS)),
      );
      return { outcome, seen };
    };

    it('hands the coordinator the definition and inputs, and reads 201 as completed', async () => {
      const { outcome, seen } = await startWith({
        status: 201,
        body: { orderId: 'ord-1' },
      });

      expect(seen).toEqual([{ definition: 'checkout', inputs: INPUTS }]);
      expect(outcome).toMatchObject({
        success: { _tag: 'completed', result: { orderId: 'ord-1' } },
      });
    });

    it('reads 409 as compensated', async () => {
      const { outcome } = await startWith({
        status: 409,
        body: { stepId: 'reserve' },
      });

      expect(outcome).toMatchObject({
        success: { _tag: 'compensated', result: { stepId: 'reserve' } },
      });
    });

    it('reads anything else as failed, with its status', async () => {
      const { outcome } = await startWith({ status: 502, body: undefined });

      expect(outcome).toMatchObject({
        success: { _tag: 'failed', status: 502 },
      });
    });

    it('reports a coordinator it cannot reach as a connection error', async () => {
      const { outcome } = await startWith(undefined);

      expect(outcome).toMatchObject({
        failure: expect.any(EntifixConnError),
      });
    });
  });
};
