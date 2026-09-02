import {
  type DomainEvent,
  type EntifixEnvelope,
  type EntifixError,
  type EntityId,
  readEnvelope,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import type { TransactionOutcome } from '../ports/transaction-handler';
import type { TransactionCommand } from './command';

/** The lifecycle state a transaction record settles into. */
export type TransactionState = 'PENDING' | 'COMPLETED' | 'FAILED' | 'STALE';

/** The facade step a given event reports. */
export type TransactionStep = 'accepted' | 'completed' | 'failed';

/**
 * What a service reports as its transaction progresses — the **payload** of a
 * {@link DomainEvent}, not the message itself. The saga tracker is a passive
 * consumer of these: it never dispatches work, it only records what the events
 * tell it.
 *
 * `transactionId` and `at` are also reachable as the message's `correlationId`
 * and `at`. That duplication is deliberate and standard (CloudEvents' `subject`
 * does the same): metadata is what the *transport* routes and deduplicates on,
 * and the payload has to stand on its own for a consumer that has already
 * unwrapped it.
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
  /**
   * Whose organization this happened in — the per-connection scoping key for
   * the reactive stream (ADR 0036).
   *
   * In `data` rather than in `meta`, under ADR 0029's rule: `meta` describes the
   * message, `data` describes the occurrence, and which vendor's catalog a
   * record was written in is a fact about what happened.
   *
   * **Optional, and absence is not a wildcard.** An event carrying no
   * organization is delivered to no tenant-scoped connection. Defaulting the
   * other way would make every event emitted before this member existed a
   * cross-tenant delivery, and it fails silently in the direction that matters.
   */
  organizationId?: string;
}

const now = (): string => new Date().toISOString();

/** The register's name for a transaction message: `transaction.completed`. */
export const transactionEventName = (step: TransactionStep): string =>
  `transaction.${step}`;

/**
 * The message id for one step of one transaction — and therefore the
 * deduplication key.
 *
 * It is the transaction id **and** the step, never the transaction id alone.
 * One transaction emits up to three messages, so a consumer keying on the
 * transaction id would treat `completed` as a redelivery of `accepted` and drop
 * the outcome. The outbox's unique index is on exactly this value, which is what
 * keeps the idempotency claim and the dedup key the same fact rather than two
 * that can drift.
 */
export const transactionEventId = (
  transactionId: string,
  step: TransactionStep,
): string => `${transactionId}:${step}`;

/** Wraps a payload as a routable message from `source`. */
const message = (
  source: string,
  data: TransactionEvent,
): DomainEvent<TransactionEvent> => ({
  name: transactionEventName(data.step),
  id: transactionEventId(data.transactionId, data.step),
  source,
  at: data.at,
  correlationId: data.transactionId,
  data,
});

export const acceptedEvent = (
  command: TransactionCommand,
  source: string,
): DomainEvent<TransactionEvent> =>
  message(source, {
    transactionId: command.transactionId,
    entity: command.entity,
    state: 'PENDING',
    step: 'accepted',
    at: now(),
    organizationId: command.organizationId,
  });

export const completedEvent = (
  command: TransactionCommand,
  outcome: TransactionOutcome,
  source: string,
): DomainEvent<TransactionEvent> =>
  message(source, {
    transactionId: command.transactionId,
    entity: command.entity,
    state: 'COMPLETED',
    step: 'completed',
    code: outcome.code,
    entityId: outcome.entityId,
    at: now(),
    organizationId: command.organizationId,
  });

export const failedEvent = (
  command: TransactionCommand,
  error: unknown,
  source: string,
): DomainEvent<TransactionEvent> =>
  message(source, {
    transactionId: command.transactionId,
    entity: command.entity,
    state: 'FAILED',
    step: 'failed',
    error: error instanceof Error ? error.message : String(error),
    at: now(),
    organizationId: command.organizationId,
  });

export type TransactionEventEnvelope = EntifixEnvelope<TransactionEvent>;

/**
 * Parses a `transactionEvent` envelope off the **HTTP** surface.
 *
 * Not the bus — bus messages are `event` envelopes and are read with core's
 * `readEventEnvelope`. This one survives for the `202` accept body and the
 * tracker's read routes, which frame a transaction *record* under the
 * `transactionEvent` discriminant. A record is not an event and that is a wart,
 * but unpicking it changes the browser's accept-shape assertion and the e2e
 * mocks, so it is tracked separately.
 */
export function readTransactionEventEnvelope(
  body: unknown,
): Effect.Effect<TransactionEvent, EntifixError> {
  return Effect.map(
    readEnvelope<TransactionEvent>(
      body,
      'transactionEvent',
      'transactionEvent',
    ),
    envelope => envelope.data,
  );
}
