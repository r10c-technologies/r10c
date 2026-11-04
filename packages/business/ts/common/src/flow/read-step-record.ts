import {
  deserializeSingleEntity,
  type Entity,
  type EntityConstructor,
} from '@entifix/core';
import { Effect } from 'effect';

import { InvalidBody } from '../failures/invalid-body.js';

/**
 * The record a flow step writes, read from the step's body. A flow hands a
 * participant its inputs flat — the record's own members, beside whatever ids
 * earlier steps bound — never an entity envelope, so a crossing write reads
 * the members it knows and ignores the rest
 * ([ADR 0066](../../../../../../docs/adr/0066-flows-run-on-a-durable-workflow-engine.md)).
 * A body that is no record of `entityConstructor` is `invalidBody`.
 */
export const readStepRecord = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
  body: unknown,
): Effect.Effect<T, InvalidBody> =>
  deserializeSingleEntity(entityConstructor, body).pipe(
    Effect.catchTag('ProtocolFailure', failure =>
      Effect.fail(new InvalidBody({ reason: failure.reason })),
    ),
    Effect.flatMap(record =>
      record === undefined
        ? Effect.fail(
            new InvalidBody({
              reason: 'a flow step names the record it writes',
            }),
          )
        : Effect.succeed(record),
    ),
  );
