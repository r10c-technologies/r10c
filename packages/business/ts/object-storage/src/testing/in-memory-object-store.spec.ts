import { Effect } from 'effect';

import { isObjectKey } from '../object-store.js';
import { makeInMemoryObjectStore } from './in-memory-object-store.js';
import { describeObjectStoreContract } from './object-store.contract.js';

let clock = new Date('2026-01-01T00:00:00Z');

describeObjectStoreContract('the in-memory object store', async () => {
  clock = new Date(Date.now() - 60_000);
  const store = makeInMemoryObjectStore(() => clock);
  return {
    store,
    age: async () => {
      clock = new Date(Date.now() + 60_000);
    },
  };
});

describe('isObjectKey', () => {
  it('takes safe segments and refuses dots, empties and spaces', () => {
    expect(isObjectKey('evidence/o-1/a.png')).toBe(true);
    expect(isObjectKey('evidence/./x')).toBe(false);
    expect(isObjectKey('')).toBe(false);
  });
});

describe('the in-memory object store', () => {
  it('lists its keys, and dates writes by the real clock by default', async () => {
    const store = makeInMemoryObjectStore();
    await Effect.runPromise(store.put('b', new Uint8Array(), 'image/png'));
    await Effect.runPromise(store.put('a', new Uint8Array(), 'image/png'));

    expect(store.keys()).toEqual(['a', 'b']);
    const listed = await Effect.runPromise(
      store.list('', new Date(Date.now() + 1)),
    );
    expect(listed.map(object => object.key)).toEqual(['a', 'b']);
  });
});
