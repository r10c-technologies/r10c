import { EntifixBuildError, EntifixTransactionError } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TransactionCommand } from './command.js';
import { makeCommandEnvelope, readCommandEnvelope } from './command.js';
import {
  acceptedEvent,
  completedEvent,
  failedEvent,
  makeTransactionEventEnvelope,
  readTransactionEventEnvelope,
} from './event.js';

const AT = '2026-07-20T12:00:00.000Z';

const aCommand = (): TransactionCommand => ({
  transactionId: 'tx-1',
  type: 'create',
  entity: 'product',
  payload: { name: 'Widget' },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(AT));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('command envelopes', () => {
  it('frames a command as a command envelope routed by the entity key', () => {
    const command = aCommand();

    expect(makeCommandEnvelope(command)).toEqual({
      meta: { type: 'command', entity: 'product' },
      data: command,
    });
  });

  it('round-trips through make/read', () => {
    const command = aCommand();

    expect(
      Effect.runSync(readCommandEnvelope(makeCommandEnvelope(command))),
    ).toEqual(command);
  });

  it('rejects a body that is not an envelope at all', () => {
    const error = Effect.runSync(
      Effect.flip(readCommandEnvelope({ transactionId: 'tx-1' })),
    );

    expect(error).toBeInstanceOf(EntifixBuildError);
    expect(error.message).toContain('no meta.type');
  });

  it('rejects an envelope of the wrong type', () => {
    const error = Effect.runSync(
      Effect.flip(
        readCommandEnvelope({
          meta: { type: 'transactionEvent', entity: 'product' },
          data: aCommand(),
        }),
      ),
    );

    expect(error.message).toContain('but got "transactionEvent"');
  });

  // A well-framed envelope carrying junk is the dangerous case: the framing
  // check passes, so the command fields have to be validated separately or a
  // malformed write reaches the handler.
  it.each([
    ['no data', undefined],
    ['null data', null],
    ['a non-string transactionId', { transactionId: 1, entity: 'product' }],
    ['no transactionId', { entity: 'product' }],
    ['a non-string entity', { transactionId: 'tx-1', entity: 7 }],
  ])('rejects a well-framed envelope carrying %s', (_label, data) => {
    const error = Effect.runSync(
      Effect.flip(
        readCommandEnvelope({ meta: { type: 'command', entity: 'product' }, data }),
      ),
    );

    expect(error).toBeInstanceOf(EntifixBuildError);
    expect(error.message).toContain('carried no valid command');
  });
});

describe('event builders', () => {
  it('reports accepted as PENDING, carrying no outcome yet', () => {
    expect(acceptedEvent(aCommand())).toEqual({
      transactionId: 'tx-1',
      entity: 'product',
      state: 'PENDING',
      step: 'accepted',
      at: AT,
    });
  });

  it('reports completed as COMPLETED, echoing the outcome', () => {
    expect(
      completedEvent(aCommand(), { code: 'product-001', entityId: 'p-1' }),
    ).toEqual({
      transactionId: 'tx-1',
      entity: 'product',
      state: 'COMPLETED',
      step: 'completed',
      code: 'product-001',
      entityId: 'p-1',
      at: AT,
    });
  });

  // The failure reason crosses a message boundary, so it has to be a string by
  // the time it is published — whatever was thrown.
  it.each([
    ['an Error', new EntifixTransactionError('execute failed'), 'execute failed'],
    ['a string', 'plain failure', 'plain failure'],
    ['an object', { code: 'E' }, '[object Object]'],
    ['undefined', undefined, 'undefined'],
  ])('reports failed as FAILED, stringifying %s', (_label, error, expected) => {
    expect(failedEvent(aCommand(), error)).toMatchObject({
      state: 'FAILED',
      step: 'failed',
      error: expected,
      at: AT,
    });
  });
});

describe('event envelopes', () => {
  it('frames an event routed by its entity key', () => {
    const event = acceptedEvent(aCommand());

    expect(makeTransactionEventEnvelope(event)).toEqual({
      meta: { type: 'transactionEvent', entity: 'product' },
      data: event,
    });
  });

  it('round-trips through make/read', () => {
    const event = acceptedEvent(aCommand());

    expect(
      Effect.runSync(
        readTransactionEventEnvelope(makeTransactionEventEnvelope(event)),
      ),
    ).toEqual(event);
  });

  it('rejects an envelope of the wrong type', () => {
    const error = Effect.runSync(
      Effect.flip(readTransactionEventEnvelope(makeCommandEnvelope(aCommand()))),
    );

    expect(error.message).toContain('but got "command"');
  });
});
