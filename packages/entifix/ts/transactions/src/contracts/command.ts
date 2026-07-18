import {
  EntifixBuildError,
  type EntifixEnvelope,
  makeEnvelope,
  readEnvelope,
  type SerializedEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

/**
 * A write intent in CQRS terms. A client no longer mutates directly — it issues
 * a command, the service runs the transaction facade over it, and answers with a
 * transaction id. `payload` is a serialized entity (the same wire shape the
 * entity envelopes carry), so a command round-trips through the existing
 * (de)serializer.
 */
export interface TransactionCommand<TPayload = SerializedEntity> {
  /** Correlates every event and record for this run. */
  transactionId: string;
  /** What to do — only `create` in phase 1. */
  type: 'create';
  /** The target entity's `key` (e.g. `product`), the routing/lock subject. */
  entity: string;
  /** The serialized entity to act on. */
  payload: TPayload;
}

export type CommandEnvelope<TPayload = SerializedEntity> = EntifixEnvelope<
  TransactionCommand<TPayload>
>;

/** Frames a command as a transport-free `command` envelope. */
export function makeCommandEnvelope<TPayload = SerializedEntity>(
  command: TransactionCommand<TPayload>,
): CommandEnvelope<TPayload> {
  return makeEnvelope('command', command.entity, command);
}

/** Parses a `command` envelope, failing on a wrong shape/type. */
export function readCommandEnvelope<TPayload = SerializedEntity>(
  body: unknown,
): Effect.Effect<TransactionCommand<TPayload>, EntifixBuildError> {
  return Effect.gen(function* () {
    const envelope = yield* readEnvelope<TransactionCommand<TPayload>>(
      body,
      'command',
      'command',
    );
    const command = envelope.data;
    if (
      command == null ||
      typeof command.transactionId !== 'string' ||
      typeof command.entity !== 'string'
    ) {
      return yield* Effect.fail(
        new EntifixBuildError('command envelope carried no valid command', undefined, {
          body,
        }),
      );
    }
    return command;
  });
}
