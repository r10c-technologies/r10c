import { describe, expect, it } from 'vitest';

import { splitParam, type TabKind, TabRegistry } from './tab-kind.js';

interface EntityAddr {
  entityKey: string;
  id: string;
}

const catalogKind: TabKind<{ entityKey: string }> = {
  kind: 'catalog',
  match: payload => (payload === '' ? null : { entityKey: payload }),
  toParam: addr => addr.entityKey,
  title: addr => `${addr.entityKey} catalog`,
  render: addr => <div>list {addr.entityKey}</div>,
};

const entityKind: TabKind<EntityAddr> = {
  kind: 'entity',
  match: payload => {
    const [entityKey, id] = payload.split(':');
    return entityKey && id ? { entityKey, id } : null;
  },
  toParam: addr => `${addr.entityKey}:${addr.id}`,
  title: addr => `${addr.entityKey} #${addr.id}`,
  render: addr => <div>edit {addr.id}</div>,
};

const registry = () => new TabRegistry().register(catalogKind).register(entityKind);

describe('splitParam', () => {
  it('splits kind and payload on the first colon', () => {
    expect(splitParam('entity:product:123')).toEqual({
      kind: 'entity',
      payload: 'product:123',
    });
  });

  it('treats a bare value as a kind with empty payload', () => {
    expect(splitParam('workspace')).toEqual({ kind: 'workspace', payload: '' });
  });
});

describe('TabRegistry', () => {
  it('resolves a registered kind to a canonical, titled, renderable tab', () => {
    const tab = registry().resolve('entity:product:123');

    expect(tab?.param).toBe('entity:product:123');
    expect(tab?.title).toBe('product #123');
    expect(tab?.render()).toBeTruthy();
  });

  it('canonicalises the param through the kind', () => {
    expect(registry().resolve('catalog:product')?.param).toBe('catalog:product');
  });

  it('returns null for an unknown kind', () => {
    expect(registry().resolve('operation:import')).toBeNull();
    expect(registry().has('operation')).toBe(false);
  });

  it('returns null when the payload is invalid for the kind', () => {
    expect(registry().resolve('catalog:')).toBeNull();
    expect(registry().resolve('entity:product')).toBeNull();
  });

  it('reports registered kinds via has', () => {
    expect(registry().has('catalog')).toBe(true);
  });
});
