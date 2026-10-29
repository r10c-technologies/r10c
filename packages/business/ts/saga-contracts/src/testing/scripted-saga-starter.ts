import { EntifixConnError } from '@entifix/core';
import { Effect } from 'effect';

import { sagaOutcomeFor, type SagaStarter } from '../saga-starter.js';
import type { CoordinatorScript } from './saga-starter.contract.js';

/**
 * A {@link SagaStarter} whose coordinator answers as `coordinator` says, for
 * the specs of whatever starts a flow. It runs `describeSagaStarterContract`,
 * so it reads an answer the way the HTTP starter does.
 */
export const makeScriptedSagaStarter = (
  coordinator: CoordinatorScript,
): SagaStarter => ({
  start: (definition, inputs, idempotencyKey) =>
    Effect.suspend(() => {
      const answer = coordinator(definition, inputs, idempotencyKey);
      return answer === undefined
        ? Effect.fail(
            new EntifixConnError(
              'Failed to reach the saga coordinator',
              undefined,
              { definition },
            ),
          )
        : Effect.succeed(sagaOutcomeFor(answer.status, answer.body));
    }),
});
