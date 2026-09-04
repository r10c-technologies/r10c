import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RecordSearchResponse } from './record-search.types';
import { createRecordSearchRoute } from './record-search-route';
import type { RecordSearchSource } from './record-search-source';

const cookieValue = vi.fn<() => string | undefined>(() => 'the-token');

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = cookieValue();
        return name === 'r10c_at' && value !== undefined
          ? { name, value }
          : undefined;
      },
    }),
}));

/**
 * Fake sources rather than real declarations: this spec is about the fan-out,
 * and `record-search-source.spec.ts` already owns what a declaration means.
 */
const fakeSource = (
  key: string,
  origin: string,
  total = 1,
): RecordSearchSource => ({
  key,
  entity: key,
  labelKey: `entity:${key}.plural`,
  url: (term, limit) => `${origin}/api/${key}?rsql=${term}&pageSize=${limit}`,
  read: body =>
    (body as { rows?: unknown[] } | undefined)?.rows === undefined
      ? undefined
      : {
          items: [
            {
              id: `${key}-1`,
              label: 'Acme',
              entity: key,
              href: `/${key}/${key}-1`,
            },
          ],
          total,
        },
});

const things = fakeSource('thing', 'http://things.test');
const people = fakeSource('person', 'http://people.test');

const answering = (status: number, body: unknown = { rows: [{}] }) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const stubFetch = (
  handler: (url: string) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> => {
  const mock = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve(handler(String(input))),
  );
  vi.stubGlobal('fetch', mock);
  return mock as unknown as ReturnType<typeof vi.fn>;
};

const get = async (
  query: string,
  options: Parameters<typeof createRecordSearchRoute>[0] = {
    sources: [things, people],
  },
): Promise<{ status: number; body: RecordSearchResponse; response: Response }> => {
  const response = await createRecordSearchRoute(options)(
    new Request(`http://app.test/api/search${query}`),
  );
  return {
    status: response.status,
    body: (await response.clone().json()) as RecordSearchResponse,
    response,
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  cookieValue.mockReturnValue('the-token');
});

describe('createRecordSearchRoute', () => {
  describe('before anything is asked upstream', () => {
    // `catalog-reference` reads are unauthenticated at the service, so without
    // this a signed-out caller gets brand matches and the answer reads as a
    // real search.
    it('refuses a caller with no session, and asks nobody', async () => {
      cookieValue.mockReturnValue(undefined);
      const fetchMock = stubFetch(() => answering(200));

      const { status, body } = await get('?q=acme');

      expect(status).toBe(401);
      expect(body).toMatchObject({ code: 'unauthenticated' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ['no term at all', ''],
      ['an empty term', '?q='],
      ['a term of whitespace', '?q=%20%20'],
      ['a one-character term', '?q=a'],
    ])('answers %s without querying anything', async (_case, query) => {
      const fetchMock = stubFetch(() => answering(200));

      const { status, body } = await get(query);

      expect(status).toBe(200);
      expect(body.groups).toEqual([]);
      expect(body.unavailable).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses an unknown source by name, and asks nobody', async () => {
      const fetchMock = stubFetch(() => answering(200));

      const { status, body } = await get('?q=acme&sources=nope');

      expect(status).toBe(400);
      expect(body).toMatchObject({
        code: 'invalidQuery',
        detail: 'unknown search source "nope"',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('a healthy fan-out', () => {
    it('returns one group per source, in declared order', async () => {
      stubFetch(() => answering(200));

      const { status, body } = await get('?q=acme');

      expect(status).toBe(200);
      expect(body.term).toBe('acme');
      expect(body.groups.map(group => group.source)).toEqual([
        'thing',
        'person',
      ]);
      expect(body.groups[0]).toMatchObject({
        entity: 'thing',
        labelKey: 'entity:thing.plural',
        total: 1,
      });
      expect(body.unavailable).toEqual([]);
    });

    it('carries the caller’s token to every source', async () => {
      const fetchMock = stubFetch(() => answering(200));

      await get('?q=acme');

      for (const call of fetchMock.mock.calls) {
        expect((call[1] as RequestInit).headers).toEqual({
          Authorization: 'Bearer the-token',
        });
      }
    });

    it('is never cached — the body is scoped to one principal', async () => {
      stubFetch(() => answering(200));

      const { response } = await get('?q=acme');

      expect(response.headers.get('cache-control')).toBe('no-store');
    });

    // Reachable and empty is a real answer. Silently omitting the group would
    // make it indistinguishable from a source that could not be asked.
    it('keeps a reachable group that matched nothing', async () => {
      stubFetch(() => answering(200, { rows: [] }));

      const { body } = await get('?q=acme&sources=thing');

      expect(body.groups).toHaveLength(1);
      expect(body.unavailable).toEqual([]);
    });
  });

  describe('a source that produces nothing', () => {
    it.each([
      [400, 'invalidQuery'],
      [401, 'unauthenticated'],
      [403, 'forbidden'],
      [404, 'notFound'],
      [409, 'noActiveOrganization'],
      [500, 'unexpected'],
      [503, 'unexpected'],
    ])('reports a %i as %s, with the status', async (status, reason) => {
      stubFetch(url =>
        url.startsWith('http://things.test')
          ? answering(status, { error: 'nope' })
          : answering(200),
      );

      const { body } = await get('?q=acme');

      expect(body.groups.map(group => group.source)).toEqual(['person']);
      expect(body.unavailable).toEqual([
        { source: 'thing', entity: 'thing', reason, status },
      ]);
    });

    it('reports a body it cannot read as unexpected', async () => {
      stubFetch(url =>
        url.startsWith('http://things.test')
          ? answering(200, { notAPage: true })
          : answering(200),
      );

      const { body } = await get('?q=acme');

      expect(body.unavailable).toEqual([
        { source: 'thing', entity: 'thing', reason: 'unexpected', status: 200 },
      ]);
    });

    it('reports a body that is not JSON as unexpected', async () => {
      stubFetch(url =>
        url.startsWith('http://things.test')
          ? new Response('<html>gateway</html>', { status: 200 })
          : answering(200),
      );

      const { body } = await get('?q=acme');

      expect(body.unavailable[0]).toMatchObject({ reason: 'unexpected' });
    });

    // The done-when: one slow service costs one group, not the search.
    it('reports a timeout, and the other source still answers', async () => {
      stubFetch(url => {
        if (url.startsWith('http://things.test')) {
          return Promise.reject(
            Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
          ) as unknown as Response;
        }
        return answering(200);
      });

      const { body } = await get('?q=acme');

      expect(body.unavailable).toEqual([
        { source: 'thing', entity: 'thing', reason: 'timeout' },
      ]);
      expect(body.groups.map(group => group.source)).toEqual(['person']);
    });

    it('reports any other throw as a network failure', async () => {
      stubFetch(url => {
        if (url.startsWith('http://things.test')) {
          return Promise.reject(
            new Error('connect ECONNREFUSED'),
          ) as unknown as Response;
        }
        return answering(200);
      });

      const { body } = await get('?q=acme');

      expect(body.unavailable).toEqual([
        { source: 'thing', entity: 'thing', reason: 'network' },
      ]);
    });
  });

  describe('narrowing and limits', () => {
    it('asks only the named source', async () => {
      const fetchMock = stubFetch(() => answering(200));

      const { body } = await get('?q=acme&sources=person');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(body.groups.map(group => group.source)).toEqual(['person']);
    });

    it('ignores empty entries in the source list', async () => {
      const fetchMock = stubFetch(() => answering(200));

      await get('?q=acme&sources=person,');

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['clamps a limit above the ceiling', '&limit=999', 'pageSize=20'],
      ['falls back on a limit that is not a number', '&limit=abc', 'pageSize=5'],
      ['falls back on a limit below one', '&limit=0', 'pageSize=5'],
      ['honours a limit in range', '&limit=3', 'pageSize=3'],
    ])('%s', async (_case, query, expected) => {
      const fetchMock = stubFetch(() => answering(200));

      await get(`?q=acme&sources=thing${query}`);

      expect(String(fetchMock.mock.calls[0]?.[0])).toContain(expected);
    });

    it('honours a host-configured default limit', async () => {
      const fetchMock = stubFetch(() => answering(200));

      await get('?q=acme', { sources: [things], limit: 2 });

      expect(String(fetchMock.mock.calls[0]?.[0])).toContain('pageSize=2');
    });

    it('honours a host-configured timeout', async () => {
      const timeout = vi.spyOn(AbortSignal, 'timeout');
      stubFetch(() => answering(200));

      await get('?q=acme', { sources: [things], timeoutMs: 250 });

      expect(timeout).toHaveBeenCalledWith(250);
      timeout.mockRestore();
    });
  });
});
