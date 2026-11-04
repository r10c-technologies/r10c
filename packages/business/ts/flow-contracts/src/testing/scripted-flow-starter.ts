import { Effect } from 'effect';

import {
  coordinatorUnreachable,
  type FlowStarter,
  flowStartOutcome,
} from '../flow-starter.js';
import type { FlowCoordinatorScript } from './flow-starter.contract.js';

/**
 * A {@link FlowStarter} whose coordinator answers as `coordinator` says, for
 * the specs of whatever starts a flow. It runs `describeFlowStarterContract`,
 * so it reads an answer the way the HTTP starter does.
 */
export const makeScriptedFlowStarter = (
  coordinator: FlowCoordinatorScript,
): FlowStarter => ({
  start: (recipe, input, idempotencyKey) =>
    Effect.suspend(() => {
      const answer = coordinator(recipe, input, idempotencyKey);
      return answer === undefined
        ? Effect.fail(coordinatorUnreachable())
        : flowStartOutcome({
            status: answer.status,
            contentType: answer.contentType,
            body: answer.body,
          });
    }),
});
