import { afterEach, describe, expect, it, vi } from 'vitest';

import { searchRecords } from './search-records';

const empty = { term: 'acme', groups: [], unavailable: [] };

const stubFetch = (response: Response) => {
  const mock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(response),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
};

/** The `init` the one recorded call was made with. */
const initOf = (mock: ReturnType<typeof stubFetch>): RequestInit =>
  mock.mock.calls[0]?.[1] ?? {};

const ok = (body: unknown = empty) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const urlOf = (mock: ReturnType<typeof stubFetch>) =>
  new URL(String(mock.mock.calls[0]?.[0]), 'http://app.test');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('searchRecords', () => {
  it('asks the same-origin route, so the httpOnly cookie rides along', async () => {
    const fetchMock = stubFetch(ok());

    await expect(searchRecords('acme')).resolves.toEqual(empty);
    expect(urlOf(fetchMock).pathname).toBe('/api/search');
    expect(urlOf(fetchMock).searchParams.get('q')).toBe('acme');
  });

  it('omits sources and limit when the caller names none', async () => {
    const fetchMock = stubFetch(ok());

    await searchRecords('acme');

    const params = urlOf(fetchMock).searchParams;
    expect(params.has('sources')).toBe(false);
    expect(params.has('limit')).toBe(false);
  });

  it('narrows to the named sources', async () => {
    const fetchMock = stubFetch(ok());

    await searchRecords('acme', { sources: ['thing', 'person'], limit: 3 });

    const params = urlOf(fetchMock).searchParams;
    expect(params.get('sources')).toBe('thing,person');
    expect(params.get('limit')).toBe('3');
  });

  it('treats an empty source list as "ask everyone"', async () => {
    const fetchMock = stubFetch(ok());

    await searchRecords('acme', { sources: [] });

    expect(urlOf(fetchMock).searchParams.has('sources')).toBe(false);
  });

  it('passes an abort signal through, so a stale term can be dropped', async () => {
    const fetchMock = stubFetch(ok());
    const controller = new AbortController();

    await searchRecords('acme', { signal: controller.signal });

    expect(initOf(fetchMock).signal).toBe(controller.signal);
  });

  it('omits the signal entirely when the caller passes none', async () => {
    const fetchMock = stubFetch(ok());

    await searchRecords('acme');

    expect(initOf(fetchMock)).not.toHaveProperty('signal');
  });

  // A per-source degradation arrives inside a `200`; a non-ok status is the
  // request itself failing, which is the caller's to handle.
  it('throws on a non-ok status', async () => {
    stubFetch(new Response(null, { status: 401 }));

    await expect(searchRecords('acme')).rejects.toThrow(
      'record search failed with 401',
    );
  });
});
