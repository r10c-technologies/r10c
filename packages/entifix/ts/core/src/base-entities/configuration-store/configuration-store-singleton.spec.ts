import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { EntifixBuildError } from '../entifix-error/index.js';
import {
  ConfigurationStoreGroupInMemory,
  ConfigurationStoreInMemory,
} from './configuration-store-singleton.js';
import type { ConfigurationStoreGroup } from './types.js';

const run = <TValue, TError>(effect: Effect.Effect<TValue, TError>) =>
  Effect.runPromise(effect);

/** The typed failure, so assertions can read its message and details. */
const failureOf = async <TValue>(
  effect: Effect.Effect<TValue, EntifixBuildError>,
): Promise<EntifixBuildError> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    throw new Error('expected the effect to fail');
  }
  const cause = exit.cause;
  if (cause._tag !== 'Fail') {
    throw new Error(`expected a Fail cause, got ${cause._tag}`);
  }
  return cause.error;
};

/** Any group getter, erased to a common type so `it.each` tables stay uniform. */
type GroupRead = (
  group: ConfigurationStoreGroup,
) => Effect.Effect<unknown, EntifixBuildError>;

const group = (
  items: Record<string, unknown> = {},
): ConfigurationStoreGroupInMemory =>
  new ConfigurationStoreGroupInMemory(
    Object.entries(items).map(([key, value]) => ({ key, value })),
  );

describe('ConfigurationStoreGroupInMemory', () => {
  describe('getString', () => {
    it('reads a key exactly by default', async () => {
      expect(await run(group({ uri: 'http://svc' }).getString('uri'))).toBe(
        'http://svc',
      );
    });

    it('stringifies a non-string value', async () => {
      expect(await run(group({ port: 3100 }).getString('port'))).toBe('3100');
    });

    // `compose` is what turns `api.product` into a full endpoint, and it must
    // normalize slashes on both sides or the adapters build `//` URLs.
    it.each([
      ['a bare base', 'http://svc/api', 'http://svc/api/product/brand'],
      ['a trailing slash on the base', 'http://svc/api/', 'http://svc/api/product/brand'],
    ])('composes segments onto %s', async (_label, base, expected) => {
      expect(
        await run(group({ api: base }).getString('api.product.brand', 'compose')),
      ).toBe(expected);
    });

    it('strips slashes from the composed segments', async () => {
      expect(
        await run(group({ api: 'http://svc' }).getString('api./product/', 'compose')),
      ).toBe('http://svc/product');
    });

    it('composes to the base alone when there are no segments', async () => {
      expect(await run(group({ api: 'http://svc' }).getString('api', 'compose'))).toBe(
        'http://svc',
      );
    });

    it('drops empty segments rather than emitting a doubled slash', async () => {
      expect(
        await run(group({ api: 'http://svc' }).getString('api..product', 'compose')),
      ).toBe('http://svc/product');
    });

    it('fails on a missing key, naming the keys that were available', async () => {
      const error = await failureOf(group({ other: 'x' }).getString('uri'));

      expect(error).toBeInstanceOf(EntifixBuildError);
      expect(error.message).toContain('"uri" not found');
      expect(error.details).toEqual({ key: 'uri', availableKeys: ['other'] });
    });

    it('treats a null value as missing', async () => {
      const error = await failureOf(group({ uri: null }).getString('uri'));

      expect(error.message).toContain('not found');
    });
  });

  describe('getNumber', () => {
    it('parses a numeric value', async () => {
      expect(await run(group({ port: '3100' }).getNumber('port'))).toBe(3100);
    });

    it.each([
      ['non-numeric text', 'nope'],
      ['an empty string', ''],
      ['whitespace only', '   '],
    ])('fails on %s', async (_label, raw) => {
      const error = await failureOf(group({ port: raw }).getNumber('port'));

      expect(error.message).toContain('is not a number');
      expect(error.details).toEqual({ key: 'port', raw });
    });
  });

  describe('getDate', () => {
    it('parses a date value', async () => {
      const parsed = await run(group({ at: '2026-01-01' }).getDate('at'));

      expect(parsed.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('fails on an unparseable date', async () => {
      const error = await failureOf(group({ at: 'not-a-date' }).getDate('at'));

      expect(error.message).toContain('is not a date');
    });
  });

  describe('array getters', () => {
    it('splits a comma-separated string, trimming and dropping blanks', async () => {
      expect(
        await run(group({ hosts: ' a , b ,, c ' }).getArrayString('hosts')),
      ).toEqual(['a', 'b', 'c']);
    });

    it('parses every element of a number array', async () => {
      expect(await run(group({ ports: '1,2,3' }).getArrayNumber('ports'))).toEqual([
        1, 2, 3,
      ]);
    });

    it('fails the whole number array when one element is not numeric', async () => {
      const error = await failureOf(group({ ports: '1,nope' }).getArrayNumber('ports'));

      expect(error.message).toContain('is not a number');
    });

    it('parses every element of a date array', async () => {
      const dates = await run(
        group({ days: '2026-01-01,2026-01-02' }).getArrayDate('days'),
      );

      expect(dates.map((date) => date.toISOString())).toEqual([
        '2026-01-01T00:00:00.000Z',
        '2026-01-02T00:00:00.000Z',
      ]);
    });

    it('fails the whole date array when one element is unparseable', async () => {
      const error = await failureOf(group({ days: '2026-01-01,nope' }).getArrayDate('days'));

      expect(error.message).toContain('is not a date');
    });
  });

  describe('optional getters', () => {
    // The point of the optional family is that absence is a value, not a
    // failure — only a *present but malformed* value fails.
    it.each<[string, GroupRead]>([
      ['getOptionalString', (g) => g.getOptionalString('missing')],
      ['getOptionalNumber', (g) => g.getOptionalNumber('missing')],
      ['getOptionalDate', (g) => g.getOptionalDate('missing')],
      [
        'getOptionalArrayNumber',
        (g) => g.getOptionalArrayNumber('missing'),
      ],
      [
        'getOptionalArrayString',
        (g) => g.getOptionalArrayString('missing'),
      ],
      [
        'getOptionalArrayDate',
        (g) => g.getOptionalArrayDate('missing'),
      ],
    ])('%s yields undefined when the key is absent', async (_label, read) => {
      expect(await run(read(group({ other: 'x' })))).toBeUndefined();
    });

    it('yields undefined for a key present with a null value', async () => {
      expect(await run(group({ uri: null }).getOptionalString('uri'))).toBeUndefined();
    });

    it('returns the present values', async () => {
      const populated = group({
        uri: 'http://svc',
        port: '3100',
        at: '2026-01-01',
        ports: '1,2',
        hosts: 'a,b',
        days: '2026-01-01',
      });

      expect(await run(populated.getOptionalString('uri'))).toBe('http://svc');
      expect(await run(populated.getOptionalNumber('port'))).toBe(3100);
      expect((await run(populated.getOptionalDate('at')))?.toISOString()).toBe(
        '2026-01-01T00:00:00.000Z',
      );
      expect(await run(populated.getOptionalArrayNumber('ports'))).toEqual([1, 2]);
      expect(await run(populated.getOptionalArrayString('hosts'))).toEqual(['a', 'b']);
      expect((await run(populated.getOptionalArrayDate('days')))?.length).toBe(1);
    });

    it('still fails when a present value is malformed', async () => {
      const error = await failureOf(group({ port: 'nope' }).getOptionalNumber('port'));

      expect(error.message).toContain('is not a number');
    });
  });

  // `match` has no defined semantics yet, and `compose` is URL-oriented so it
  // is meaningful only for strings. Both must fail loudly rather than silently
  // degrading to `exact`.
  describe('unsupported extract modes', () => {
    it.each<[string, GroupRead]>([
      ['getString', (g) => g.getString('k', 'match')],
      ['getNumber', (g) => g.getNumber('k', 'match')],
      ['getDate', (g) => g.getDate('k', 'compose')],
      ['getArrayString', (g) => g.getArrayString('k', 'compose')],
      ['getArrayNumber', (g) => g.getArrayNumber('k', 'match')],
      ['getArrayDate', (g) => g.getArrayDate('k', 'match')],
      [
        'getOptionalString',
        (g) => g.getOptionalString('k', 'compose'),
      ],
      [
        'getOptionalNumber',
        (g) => g.getOptionalNumber('k', 'match'),
      ],
      ['getOptionalDate', (g) => g.getOptionalDate('k', 'match')],
      [
        'getOptionalArrayNumber',
        (g) => g.getOptionalArrayNumber('k', 'match'),
      ],
      [
        'getOptionalArrayString',
        (g) => g.getOptionalArrayString('k', 'match'),
      ],
      [
        'getOptionalArrayDate',
        (g) => g.getOptionalArrayDate('k', 'match'),
      ],
    ])('%s rejects a mode it does not implement', async (_label, read) => {
      const error = await failureOf(read(group({ k: 'v' })));

      expect(error.message).toContain('is not implemented yet');
    });
  });

  it('defaults to an empty item list', async () => {
    const error = await failureOf(new ConfigurationStoreGroupInMemory().getString('k'));

    expect(error.details).toEqual({ key: 'k', availableKeys: [] });
  });
});

describe('ConfigurationStoreInMemory', () => {
  it('scopes a group view to that group’s items', async () => {
    const store = new ConfigurationStoreInMemory({
      mongo: [{ key: 'uri', value: 'mongodb://host' }],
      redis: [{ key: 'uri', value: 'redis://host' }],
    });

    expect(await run(store.in('mongo').getString('uri'))).toBe('mongodb://host');
    expect(await run(store.in('redis').getString('uri'))).toBe('redis://host');
  });

  it('yields an empty group for a name that was never loaded', async () => {
    const store = new ConfigurationStoreInMemory({});

    const error = await failureOf(store.in('absent').getString('uri'));

    expect(error.details).toEqual({ key: 'uri', availableKeys: [] });
  });

  it('defaults to an empty configuration', async () => {
    const error = await failureOf(new ConfigurationStoreInMemory().in('any').getString('k'));

    expect(error.message).toContain('not found');
  });
});
