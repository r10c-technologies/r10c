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
  /**
   * Correlates every event and record for this run, and **the client mints it**
   * (ADR 0028).
   *
   * It is also the stored entity's id and the idempotency key: re-sending a
   * command with the same id returns the first one's answer instead of writing
   * twice. That makes it untrusted input which becomes a primary key, so
   * {@link readCommandEnvelope} constrains it to a UUID rather than accepting
   * any string.
   */
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

/**
 * A canonical RFC 9562 UUID — any version, standard variant.
 *
 * The transaction id arrives from the client and becomes a primary key, so the
 * key space it may address has to be fixed rather than "whatever string was
 * sent". Accepting every version keeps v4 (random) and v7 (time-ordered) both
 * usable without the wire format becoming a second decision.
 */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Whether a value is a usable transaction id. */
export const isTransactionId = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

/**
 * Parses a `command` envelope, failing on a wrong shape/type.
 *
 * A command carrying no valid transaction id is rejected outright — there is no
 * server-side fallback that mints one. That is deliberate: the id is the
 * idempotency key, and a caller who omits it silently loses retry safety while
 * appearing to succeed.
 */
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
      !isTransactionId(command.transactionId) ||
      typeof command.entity !== 'string'
    ) {
      return yield* Effect.fail(
        new EntifixBuildError(
          'command envelope carried no valid command',
          undefined,
          {
            body,
          },
        ),
      );
    }
    return command;
  });
}
