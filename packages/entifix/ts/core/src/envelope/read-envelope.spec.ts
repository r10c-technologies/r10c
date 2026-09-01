import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { EntifixBuildError } from '../base-entities/entifix-error/index.js';
import { accessor } from '../entity-definition/decorators/accessor/index.js';
import { entity } from '../entity-definition/decorators/entity/index.js';
import type { Entity, EntityId } from '../types/Entity.js';
import { matchesEventPattern } from './event-pattern.js';
import {
  envelopeEntityName,
  makeEntityCollectionEnvelope,
  makeEntityPageEnvelope,
  makeEnvelope,
  makeEventEnvelope,
} from './make-envelope.js';
import {
  isEntifixEnvelope,
  readEntityPageEnvelope,
  readEnvelope,
  readEventEnvelope,
} from './read-envelope.js';
import type { DomainEvent } from './types.js';

/** No `key`, so `meta.entity` must fall back to the class name. */
@entity()
class Unkeyed implements Entity {
  #id?: EntityId;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

describe('envelopeEntityName', () => {
  it('falls back to the class name when the entity declares no key', () => {
    expect(envelopeEntityName(Unkeyed)).toBe('Unkeyed');
  });
});

describe('makeEnvelope', () => {
  // Commands and transaction events carry their own `data` shapes, so they
  // cannot go through the entity builders — but they must frame identically.
  it('frames an arbitrary payload with meta.type and meta.entity', () => {
    expect(makeEnvelope('command', 'product', { code: 'P-1' })).toEqual({
      meta: { type: 'command', entity: 'product' },
      data: { code: 'P-1' },
    });
  });

  it('carries links when supplied and omits the key otherwise', () => {
    const links = [
      { rel: 'self', href: '/api/product', method: 'GET' as const },
    ];

    expect(makeEnvelope('command', 'product', {}, links).meta.links).toEqual(
      links,
    );
    expect(makeEnvelope('command', 'product', {}).meta).not.toHaveProperty(
      'links',
    );
  });
});

describe('makeEntityCollectionEnvelope', () => {
  it('carries links when supplied', () => {
    const links = [
      { rel: 'self', href: '/api/unkeyed', method: 'GET' as const },
    ];

    expect(makeEntityCollectionEnvelope(Unkeyed, [], links).meta.links).toEqual(
      links,
    );
  });
});

describe('makeEntityPageEnvelope', () => {
  it('carries links when supplied', () => {
    const links = [
      { rel: 'next', href: '/api/unkeyed?page=2', method: 'GET' as const },
    ];
    const page = { items: [], total: 0, request: {} };

    expect(makeEntityPageEnvelope(Unkeyed, page, links).meta.links).toEqual(
      links,
    );
  });
});

describe('isEntifixEnvelope', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'raw'],
    ['a number', 7],
    ['an object without meta', { data: {} }],
    ['an object whose meta is null', { meta: null }],
    ['an object whose meta.type is not a string', { meta: { type: 7 } }],
  ])('rejects %s', (_label, body) => {
    expect(isEntifixEnvelope(body)).toBe(false);
  });

  it('accepts a body carrying a string meta.type', () => {
    expect(isEntifixEnvelope({ meta: { type: 'entity' }, data: {} })).toBe(
      true,
    );
  });
});

describe('readEnvelope', () => {
  it('narrows a matching envelope', () => {
    const envelope = makeEnvelope('transactionEvent', 'product', { at: 'now' });

    expect(Effect.runSync(readEnvelope(envelope, 'transactionEvent'))).toBe(
      envelope,
    );
  });

  it('fails when the body is not an envelope, naming the label', () => {
    const error = Effect.runSync(
      readEnvelope({ at: 'now' }, 'transactionEvent', 'saga message').pipe(
        Effect.flip,
      ),
    );

    expect(error).toBeInstanceOf(EntifixBuildError);
    expect(error.message).toContain('no meta.type');
    expect(error.message).toContain('saga message');
  });

  it('defaults the label when none is given', () => {
    const error = Effect.runSync(
      readEnvelope(null, 'command').pipe(Effect.flip),
    );

    expect(error.message).toContain('"message"');
  });

  it('fails on a type mismatch, reporting expected and actual', () => {
    const error = Effect.runSync(
      readEnvelope(
        makeEnvelope('command', 'product', {}),
        'transactionEvent',
      ).pipe(Effect.flip),
    );

    expect(error.message).toContain('type "transactionEvent"');
    expect(error.message).toContain('but got "command"');
    expect(error.details).toMatchObject({
      expected: 'transactionEvent',
      actual: 'command',
    });
  });
});

// A page envelope with no data at all is what a misbehaving service sends; the
// reader must degrade to an empty page rather than propagate undefined.
describe('readEntityPageEnvelope with an empty payload', () => {
  it('defaults total and request when data is absent', () => {
    const page = Effect.runSync(
      readEntityPageEnvelope(Unkeyed, {
        meta: { type: 'entityPage', entity: 'Unkeyed' },
      }),
    );

    expect(page).toEqual({ items: [], total: 0, request: {} });
  });

  it('defaults total and request when data is present but empty', () => {
    const page = Effect.runSync(
      readEntityPageEnvelope(Unkeyed, {
        meta: { type: 'entityPage', entity: 'Unkeyed' },
        data: {},
      }),
    );

    expect(page).toEqual({ items: [], total: 0, request: {} });
  });
});

describe('event envelopes', () => {
  const anEvent = (
    overrides: Partial<DomainEvent<{ sku: string }>> = {},
  ): DomainEvent<{ sku: string }> => ({
    name: 'catalog.published',
    id: 'evt-1',
    source: 'marketplace-admin',
    at: '2026-01-01T00:00:00.000Z',
    correlationId: 'tx-1',
    data: { sku: 'W-1' },
    ...overrides,
  });

  // The split the whole envelope exists for: metadata describes the message,
  // `data` describes what happened, and a consumer never has to dig through one
  // to find the other.
  it('frames metadata under meta.event and the payload under data', () => {
    expect(makeEventEnvelope(anEvent())).toEqual({
      meta: {
        type: 'event',
        event: {
          name: 'catalog.published',
          id: 'evt-1',
          source: 'marketplace-admin',
          at: '2026-01-01T00:00:00.000Z',
          correlationId: 'tx-1',
        },
      },
      data: { sku: 'W-1' },
    });
  });

  // A bus message is about an occurrence, not necessarily about an entity —
  // `settlement.run.completed` is about a run. Inventing a label here is what
  // the old required `meta.entity` forced.
  it('sets no entity label', () => {
    expect(makeEventEnvelope(anEvent()).meta).not.toHaveProperty('entity');
  });

  it('round-trips through make/read', () => {
    const event = anEvent();

    expect(Effect.runSync(readEventEnvelope(makeEventEnvelope(event)))).toEqual(
      event,
    );
  });

  it('keeps an event with no correlation id readable', () => {
    const event = anEvent({ correlationId: undefined });

    const read = Effect.runSync(readEventEnvelope(makeEventEnvelope(event)));

    expect(read.correlationId).toBeUndefined();
  });

  it('rejects an envelope of the wrong type', () => {
    const error = Effect.runSync(
      Effect.flip(readEventEnvelope(makeEnvelope('command', 'product', {}))),
    );

    expect(error.message).toContain('but got "command"');
  });

  it('rejects a body that is not an envelope at all', () => {
    const error = Effect.runSync(
      Effect.flip(readEventEnvelope({ not: 'an envelope' })),
    );

    expect(error.message).toContain('carried no meta.type');
  });

  // Each of these is a message the transport cannot do its job with: no `name`
  // is unroutable, no `id` is undeduplicatable. Failing loudly beats arriving
  // with a silently defaulted key.
  it.each([
    ['name', { name: '' }],
    ['id', { id: '' }],
    ['source', { source: '' }],
    ['at', { at: '' }],
  ])('rejects an event missing %s', (member, overrides) => {
    const envelope = makeEventEnvelope(
      anEvent(overrides as Partial<DomainEvent<{ sku: string }>>),
    );

    const error = Effect.runSync(Effect.flip(readEventEnvelope(envelope)));

    expect(error.message).toContain(member);
  });

  it('rejects an envelope carrying no meta.event at all', () => {
    const error = Effect.runSync(
      Effect.flip(readEventEnvelope({ meta: { type: 'event' }, data: {} })),
    );

    expect(error.message).toContain('name, id, source, at');
  });
});

describe('matchesEventPattern', () => {
  // AMQP topic semantics, which the broker applies in production. The point of
  // having them here is that the in-memory bus and the register check route the
  // same way the exchange does.
  it.each([
    ['an exact name', 'catalog.published', 'catalog.published', true],
    ['a different name', 'catalog.published', 'catalog.retired', false],
    ['* against one word', 'transaction.*', 'transaction.completed', true],
    [
      '* against two words',
      'transaction.*',
      'transaction.step.completed',
      false,
    ],
    ['* against zero words', 'transaction.*', 'transaction', false],
    ['# against one word', 'transaction.#', 'transaction.completed', true],
    ['# against two words', 'transaction.#', 'transaction.step.done', true],
    ['# against zero words', 'transaction.#', 'transaction', true],
    ['a bare #', '#', 'anything.at.all', true],
    ['a leading *', '*.published', 'catalog.published', true],
    ['a shorter name', 'catalog.published', 'catalog', false],
    ['a longer name', 'catalog', 'catalog.published', false],
    ['# in the middle', 'a.#.d', 'a.b.c.d', true],
    ['# in the middle, no match', 'a.#.d', 'a.b.c.e', false],
  ])('matches %s', (_label, pattern, name, expected) => {
    expect(matchesEventPattern(pattern, name)).toBe(expected);
  });
});
