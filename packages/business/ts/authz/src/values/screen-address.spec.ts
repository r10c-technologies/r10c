import { describe, expect, it } from 'vitest';

import { parseScreenPayload, screenAddress } from './screen-address.js';
import { ScreenTypes } from './screen-type.js';

describe('screenAddress', () => {
  it('writes a list address as <type>:<key>', () => {
    expect(screenAddress({ type: 'master', key: 'product-brand' })).toBe(
      'master:product-brand',
    );
  });

  it('writes a record address as <type>:<key>:<id>', () => {
    expect(
      screenAddress({ type: 'master', key: 'product-brand', id: 'abc123' }),
    ).toBe('master:product-brand:abc123');
  });

  it('serializes every screen type, not only the one in use today', () => {
    // `master` is the only populated type at v1. The grammar is general so that
    // an Operaciones or Asistentes screen needs no second address shape.
    for (const type of ScreenTypes) {
      expect(screenAddress({ type, key: 'thing' })).toBe(`${type}:thing`);
    }
  });
});

describe('parseScreenPayload', () => {
  it('round-trips a list address once the kind is split off', () => {
    const address = screenAddress({ type: 'master', key: 'product-brand' });
    expect(parseScreenPayload(address.slice('master:'.length))).toEqual({
      key: 'product-brand',
    });
  });

  it('round-trips a record address once the kind is split off', () => {
    const address = screenAddress({
      type: 'master',
      key: 'product-brand',
      id: 'abc123',
    });
    expect(parseScreenPayload(address.slice('master:'.length))).toEqual({
      key: 'product-brand',
      id: 'abc123',
    });
  });

  it('keeps colons inside an id, splitting only on the first', () => {
    expect(parseScreenPayload('product:a:b')).toEqual({
      key: 'product',
      id: 'a:b',
    });
  });

  it('rejects an empty payload', () => {
    expect(parseScreenPayload('')).toBeNull();
  });

  it('rejects an empty id', () => {
    // `{ key: 'brand', id: '' }` would open the record editor for no record.
    expect(parseScreenPayload('brand:')).toBeNull();
  });

  it('rejects an empty key', () => {
    expect(parseScreenPayload(':abc123')).toBeNull();
  });
});
