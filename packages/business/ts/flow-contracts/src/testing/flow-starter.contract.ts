import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { FlowStarter } from '../flow-starter.js';

/**
 * How the coordinator behind a subject answers a start: a status, a content
 * type and a body, or `undefined` for a coordinator that cannot be reached.
 */
export type FlowCoordinatorScript = (
  recipe: string,
  input: unknown,
  idempotencyKey: string,
) =>
  | {
      readonly status: number;
      readonly contentType?: string;
      readonly body: unknown;
    }
  | undefined;

const INPUT = { orderId: 'ord-1' };

/** A coordinator's `202`: the flow's id and where to follow it. */
export const acceptedAnswer = (flowId: string) => ({
  status: 202,
  contentType: 'application/json',
  body: {
    meta: { type: 'flowAccepted' },
    data: {
      flowId,
      links: [
        { rel: 'status', href: `/api/realtime/flow/${flowId}` },
        { rel: 'stream', href: '/api/realtime/stream' },
      ],
    },
  },
});

/**
 * What every {@link FlowStarter} must guarantee: it hands the coordinator the
 * recipe, the input and the key it was given; a `202` is the accepted flow;
 * a problem body is the refusal it names, typed; any other answer is a
 * protocol failure; and a coordinator it cannot reach is an unavailable
 * upstream rather than a refused flow.
 */
export const describeFlowStarterContract = (
  name: string,
  make: (coordinator: FlowCoordinatorScript) => FlowStarter | Promise<FlowStarter>,
) => {
  describe(`${name} honours the FlowStarter contract`, () => {
    const startWith = async (answer: ReturnType<FlowCoordinatorScript>) => {
      const seen: unknown[] = [];
      const starter = await make((recipe, input, idempotencyKey) => {
        seen.push({ recipe, input, idempotencyKey });
        return answer;
      });
      const outcome = await Effect.runPromise(
        Effect.result(starter.start('cancellation', INPUT, 'start-1')),
      );
      return { outcome, seen };
    };

    it('hands the coordinator the recipe, input and key, and reads 202 as the accepted flow', async () => {
      const { outcome, seen } = await startWith(acceptedAnswer('flow-1'));

      expect(seen).toEqual([
        { recipe: 'cancellation', input: INPUT, idempotencyKey: 'start-1' },
      ]);
      expect(outcome).toMatchObject({
        success: {
          flowId: 'flow-1',
          links: [
            { rel: 'status', href: '/api/realtime/flow/flow-1' },
            { rel: 'stream', href: '/api/realtime/stream' },
          ],
        },
      });
    });

    it('reads a problem body as the refusal it names', async () => {
      const { outcome } = await startWith({
        status: 404,
        contentType: 'application/problem+json',
        body: {
          type: 'about:blank',
          title: 'notFound',
          status: 404,
          code: 'notFound',
          category: 'notFound',
        },
      });

      expect(outcome).toMatchObject({
        failure: { code: 'notFound', category: 'notFound' },
      });
    });

    it('reads a 202 that is no flowAccepted envelope, and a bare error, as protocol failures', async () => {
      const accepted = await startWith({ status: 202, body: { flowId: 'f' } });
      const bare = await startWith({ status: 500, body: 'oops' });

      expect(accepted.outcome).toMatchObject({
        failure: { category: 'protocol', upstreamStatus: 202 },
      });
      expect(bare.outcome).toMatchObject({
        failure: { category: 'protocol', upstreamStatus: 500 },
      });
    });

    it('reports a coordinator it cannot reach as an unavailable upstream', async () => {
      const { outcome } = await startWith(undefined);

      expect(outcome).toMatchObject({
        failure: {
          _tag: 'UpstreamUnavailable',
          upstream: 'transaction-service',
        },
      });
    });
  });
};
