import {
  accessor,
  type Entity,
  entity,
  type EntityId,
} from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import {
  entityQueryKey,
  entityQueryScope,
  entityQueryScopeFor,
  isDefaultListQuery,
} from './entity-query-key.js';

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

  // What arrives out of band — a record search result, a change event — is the
  // wire name, never a constructor. Both paths have to land on one key or
  // "invalidate the same scope" is a convention rather than a guarantee.
  it('derives the same scope from the wire name alone', () => {
    expect(entityQueryScopeFor('widget')).toEqual(entityQueryScope(Widget));
  });
});

describe('isDefaultListQuery', () => {
  const key = (
    entity: string,
    page: number,
    rsql: string,
    sort: string,
  ): { queryKey: readonly unknown[] } => ({
    queryKey: ['entity', entity, 'load', page, 10, rsql, sort],
  });

  const matches = isDefaultListQuery(Widget);

  // The one view where "prepend to the top" is unambiguous.
  it('matches the first page with no filter and no sort', () => {
    expect(matches(key('widget', 1, '', ''))).toBe(true);
  });

  // `pageSize` is a display preference, not part of what makes a view default.
  it('ignores the page size', () => {
    expect(
      matches({ queryKey: ['entity', 'widget', 'load', 1, 50, '', ''] }),
    ).toBe(true);
  });

  // Each of these is a view the record may not belong on, or does not belong at
  // the top of — the reason the patch may not use the scope prefix.
  it('rejects a later page, a filtered view and a sorted one', () => {
    expect(matches(key('widget', 2, '', ''))).toBe(false);
    expect(matches(key('widget', 1, 'name==Acme', ''))).toBe(false);
    expect(matches(key('widget', 1, '', '+name'))).toBe(false);
  });

  it('rejects another entity, and any key that is not a list load', () => {
    expect(matches(key('gadget', 1, '', ''))).toBe(false);
    expect(matches({ queryKey: ['entity', 'widget', 'link-label', 'w-1'] })).toBe(
      false,
    );
    expect(matches({ queryKey: ['entity-metadata', 'widget'] })).toBe(false);
  });
});
