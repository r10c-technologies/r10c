import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { EntifixBuildError } from '../base-entities/entifix-error/index.js';
import { accessor } from '../entity-definition/decorators/accessor/index.js';
import { entity } from '../entity-definition/decorators/entity/index.js';
import type { Entity, EntityId } from '../types/Entity.js';
import {
  envelopeEntityName,
  makeEntityCollectionEnvelope,
  makeEntityPageEnvelope,
  makeEnvelope,
} from './make-envelope.js';
import {
  isEntifixEnvelope,
  readEntityPageEnvelope,
  readEnvelope,
} from './read-envelope.js';

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
    const links = [{ rel: 'self', href: '/api/product', method: 'GET' as const }];

    expect(makeEnvelope('command', 'product', {}, links).meta.links).toEqual(links);
    expect(makeEnvelope('command', 'product', {}).meta).not.toHaveProperty('links');
  });
});

describe('makeEntityCollectionEnvelope', () => {
  it('carries links when supplied', () => {
    const links = [{ rel: 'self', href: '/api/unkeyed', method: 'GET' as const }];

    expect(makeEntityCollectionEnvelope(Unkeyed, [], links).meta.links).toEqual(links);
  });
});

describe('makeEntityPageEnvelope', () => {
  it('carries links when supplied', () => {
    const links = [{ rel: 'next', href: '/api/unkeyed?page=2', method: 'GET' as const }];
    const page = { items: [], total: 0, request: {} };

    expect(makeEntityPageEnvelope(Unkeyed, page, links).meta.links).toEqual(links);
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
    expect(isEntifixEnvelope({ meta: { type: 'entity' }, data: {} })).toBe(true);
  });
});

describe('readEnvelope', () => {
  it('narrows a matching envelope', () => {
    const envelope = makeEnvelope('transactionEvent', 'product', { at: 'now' });

    expect(Effect.runSync(readEnvelope(envelope, 'transactionEvent'))).toBe(envelope);
  });

  it('fails when the body is not an envelope, naming the label', () => {
    const error = Effect.runSync(
      readEnvelope({ at: 'now' }, 'transactionEvent', 'saga message').pipe(Effect.flip),
    );

    expect(error).toBeInstanceOf(EntifixBuildError);
    expect(error.message).toContain('no meta.type');
    expect(error.message).toContain('saga message');
  });

  it('defaults the label when none is given', () => {
    const error = Effect.runSync(readEnvelope(null, 'command').pipe(Effect.flip));

    expect(error.message).toContain('"message"');
  });

  it('fails on a type mismatch, reporting expected and actual', () => {
    const error = Effect.runSync(
      readEnvelope(makeEnvelope('command', 'product', {}), 'transactionEvent').pipe(
        Effect.flip,
      ),
    );

    expect(error.message).toContain('type "transactionEvent"');
    expect(error.message).toContain('but got "command"');
    expect(error.details).toMatchObject({ expected: 'transactionEvent', actual: 'command' });
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
