import { accessor, entity, type Entity, type EntityId } from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import { entityQueryKey, entityQueryScope } from './entity-query-key.js';

@entity({ key: 'widget' })
class Widget implements Entity {
  #id?: EntityId;
  #name?: string;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }
}

describe('entityQueryKey', () => {
  it('scopes the key by the entity key and serialized request', () => {
    const key = entityQueryKey(Widget, { page: 2, pageSize: 20 });

    expect(key[0]).toBe('entity');
    expect(key[1]).toBe('widget');
    expect(key[2]).toContain('page=2');
    expect(key[2]).toContain('pageSize=20');
  });

  it('produces equal keys for equal requests (stable across identity)', () => {
    const a = entityQueryKey(Widget, { page: 1, pageSize: 10 });
    const b = entityQueryKey(Widget, { page: 1, pageSize: 10 });

    expect(a).toEqual(b);
  });

  it('produces different request segments for different pages', () => {
    const first = entityQueryKey(Widget, { page: 1, pageSize: 10 });
    const second = entityQueryKey(Widget, { page: 2, pageSize: 10 });

    expect(first[2]).not.toBe(second[2]);
  });

  it('exposes the entity scope as the key prefix for invalidation', () => {
    const scope = entityQueryScope(Widget);
    const key = entityQueryKey(Widget, { page: 1, pageSize: 10 });

    expect(scope).toEqual(['entity', 'widget']);
    expect(key.slice(0, 2)).toEqual(scope);
  });
});
