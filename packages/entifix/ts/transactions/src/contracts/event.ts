import {
  type EntifixEnvelope,
  type EntifixError,
  type EntityId,
  makeEnvelope,
  readEnvelope,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import type { TransactionOutcome } from '../ports/transaction-handler';
import type { TransactionCommand } from './command';

/** The lifecycle state a transaction record settles into. */
export type TransactionState =
  | 'PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'STALE';

/** The facade step a given event reports. */
export type TransactionStep = 'accepted' | 'completed' | 'failed';

/**
 * What a service publishes to the bus as its transaction progresses. The
 * `transaction-manager` is a passive consumer of these — it never dispatches
 * work, it only records what the events tell it.
 */
export interface TransactionEvent {
  transactionId: string;
  /** The target entity's `key`. */
  entity: string;
  state: TransactionState;
  step: TransactionStep;
  /** The assigned code once executed (`product-001`). */
  code?: string;
  /** The stored entity id once executed. */
  entityId?: EntityId;
  /** Failure detail when `step === 'failed'`. */
  error?: string;
  /** ISO-8601 emission time. */
  at: string;
}

const now = (): string => new Date().toISOString();

export const acceptedEvent = (command: TransactionCommand): TransactionEvent => ({
  transactionId: command.transactionId,
  entity: command.entity,
  state: 'PENDING',
  step: 'accepted',
  at: now(),
});

export const completedEvent = (
  command: TransactionCommand,
  outcome: TransactionOutcome,
): TransactionEvent => ({
  transactionId: command.transactionId,
  entity: command.entity,
  state: 'COMPLETED',
  step: 'completed',
  code: outcome.code,
  entityId: outcome.entityId,
  at: now(),
});

export const failedEvent = (
  command: TransactionCommand,
  error: unknown,
): TransactionEvent => ({
  transactionId: command.transactionId,
  entity: command.entity,
  state: 'FAILED',
  step: 'failed',
  error: error instanceof Error ? error.message : String(error),
  at: now(),
});

export type TransactionEventEnvelope = EntifixEnvelope<TransactionEvent>;

/** Frames an event as a `transactionEvent` envelope for the bus. */
export function makeTransactionEventEnvelope(
  event: TransactionEvent,
): TransactionEventEnvelope {
  return makeEnvelope('transactionEvent', event.entity, event);
}

/** Parses a `transactionEvent` envelope off the bus. */
export function readTransactionEventEnvelope(
  body: unknown,
): Effect.Effect<TransactionEvent, EntifixError> {
  return Effect.map(
    readEnvelope<TransactionEvent>(body, 'transactionEvent', 'transactionEvent'),
    (envelope) => envelope.data,
  );
}
