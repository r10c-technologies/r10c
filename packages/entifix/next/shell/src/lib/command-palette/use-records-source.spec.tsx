import type { CommandSource } from '@r10c/entifix-ts-core';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecordSearchResponse } from '../search/record-search.types.js';
import { RECORD_SEARCH_DEBOUNCE_MS } from './palette-command.js';
import { useRecordsSource } from './use-records-source.js';

vi.mock('next/navigation', () => ({ usePathname: () => '/es/home' }));

const answer = (
  overrides: Partial<RecordSearchResponse> = {},
): RecordSearchResponse => ({
  term: 'acme',
  groups: [
    {
      source: 'product-specification',
      entity: 'product-specification',
      labelKey: 'entity:product-specification.plural',
      items: [
        {
          id: 'p-1',
          label: 'Acme Lamp',
          sublabel: 'ACME-1',
          entity: 'product-specification',
          href: '/catalog/product/p-1',
        },
      ],
      total: 4,
    },
  ],
  unavailable: [],
  ...overrides,
});

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const respond = (body: RecordSearchResponse) =>
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });

const settle = async () => {
  await act(async () => {
    vi.advanceTimersByTime(RECORD_SEARCH_DEBOUNCE_MS);
  });
};

const groupsOf = (source: CommandSource) => source.groups;

describe('useRecordsSource', () => {
  it('queries nothing while the palette is closed', () => {
    renderHook(() => useRecordsSource('acme', false));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('contributes no group at all on an empty term', () => {
    const { result } = renderHook(() => useRecordsSource('', true));

    expect(groupsOf(result.current)).toEqual([]);
  });

  it('says why rather than claiming nothing matched, below the floor', async () => {
    const { result } = renderHook(() => useRecordsSource('a', true));

    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(groupsOf(result.current)[0].unavailable).toEqual({
      message: 'Escribe al menos 2 caracteres para buscar registros.',
      severity: 'scope',
    });
  });

  it('waits out the debounce before spending a fan-out', async () => {
    respond(answer());
    renderHook(() => useRecordsSource('acme', true));

    expect(fetchMock).not.toHaveBeenCalled();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders one group per source, titled by the entity’s own plural key', async () => {
    respond(answer());
    const { result } = renderHook(() => useRecordsSource('acme', true));
    await settle();

    await waitFor(() =>
      expect(groupsOf(result.current)[0].label).toBe('Productos'),
    );
    expect(groupsOf(result.current)[0].options).toEqual([
      {
        id: 'record:product-specification:p-1',
        label: 'Acme Lamp',
        sublabel: 'ACME-1',
        href: '/es/catalog/product/p-1',
      },
    ]);
    // Pre-limit, so "3 más" is renderable.
    expect(groupsOf(result.current)[0].total).toBe(4);
  });

  it('omits a sublabel the source did not declare', async () => {
    const body = answer();
    respond({
      ...body,
      groups: [
        {
          ...body.groups[0],
          items: [{ ...body.groups[0].items[0], sublabel: undefined }],
        },
      ],
    });
    const { result } = renderHook(() => useRecordsSource('acme', true));
    await settle();

    await waitFor(() =>
      expect(groupsOf(result.current)[0].options).toHaveLength(1),
    );
    expect(groupsOf(result.current)[0].options[0].sublabel).toBeUndefined();
  });

  it('names a source that is out of scope without painting it as an outage', async () => {
    respond(
      answer({
        groups: [],
        unavailable: [
          {
            source: 'product-specification',
            entity: 'product-specification',
            reason: 'noActiveOrganization',
            status: 409,
          },
        ],
      }),
    );
    const { result } = renderHook(() => useRecordsSource('acme', true));
    await settle();

    await waitFor(() =>
      expect(groupsOf(result.current)[0].unavailable?.severity).toBe('scope'),
    );
    expect(groupsOf(result.current)[0].label).toBe('Productos');
    expect(groupsOf(result.current)[0].unavailable?.message).toContain(
      'Selecciona una organización',
    );
  });

  it('names a source that could not be reached as one that could not be reached', async () => {
    respond(
      answer({
        groups: [],
        unavailable: [
          {
            source: 'product-specification',
            entity: 'product-specification',
            reason: 'timeout',
          },
        ],
      }),
    );
    const { result } = renderHook(() => useRecordsSource('acme', true));
    await settle();

    await waitFor(() =>
      expect(groupsOf(result.current)[0].unavailable?.severity).toBe(
        'reachability',
      ),
    );
  });

  it('names the whole endpoint failing, rather than reporting no matches', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    const { result } = renderHook(() => useRecordsSource('acme', true));
    await settle();

    await waitFor(() =>
      expect(groupsOf(result.current)[0].unavailable?.severity).toBe(
        'reachability',
      ),
    );
    expect(groupsOf(result.current)[0].isLoading).toBe(false);
  });

  it('reports the wait before the first answer lands', () => {
    respond(answer());
    const { result } = renderHook(() => useRecordsSource('acme', true));

    expect(groupsOf(result.current)[0].isLoading).toBe(true);
    expect(groupsOf(result.current)[0].unavailable).toBeUndefined();
  });

  it('keeps the previous rows on screen while a newer term is in flight', async () => {
    respond(answer());
    const { result, rerender } = renderHook(
      ({ term }: { term: string }) => useRecordsSource(term, true),
      { initialProps: { term: 'acme' } },
    );
    await settle();
    await waitFor(() =>
      expect(groupsOf(result.current)[0].options).toHaveLength(1),
    );

    rerender({ term: 'acmee' });

    expect(groupsOf(result.current)[0].options).toHaveLength(1);
    expect(groupsOf(result.current)[0].isLoading).toBe(true);
  });

  it('aborts the request in flight when the term moves on', async () => {
    respond(answer());
    const { rerender } = renderHook(
      ({ term }: { term: string }) => useRecordsSource(term, true),
      { initialProps: { term: 'acme' } },
    );
    await settle();

    rerender({ term: 'acmee' });
    await settle();

    const signals = fetchMock.mock.calls.map(
      call => (call[1] as RequestInit).signal,
    );
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('drops an answer that landed after the term had already moved on', async () => {
    // The abort is best-effort: a response already in the pipe still resolves,
    // and writing it would replace the current term's rows with the previous
    // term's matches.
    const settlers: Array<(body: RecordSearchResponse) => void> = [];
    fetchMock.mockImplementation(
      () =>
        new Promise(resolve => {
          settlers.push(body =>
            resolve({ ok: true, status: 200, json: async () => body }),
          );
        }),
    );
    const { result, rerender } = renderHook(
      ({ term }: { term: string }) => useRecordsSource(term, true),
      { initialProps: { term: 'acme' } },
    );
    await settle();
    rerender({ term: 'acmee' });
    await settle();

    await act(async () => {
      settlers[0](answer());
    });

    expect(groupsOf(result.current)[0].options).toEqual([]);
    expect(groupsOf(result.current)[0].isLoading).toBe(true);
  });

  it('reports nothing about a request the term moved on from', async () => {
    // A real abort rejects the fetch, and that rejection must not be shown: the
    // term it belonged to is no longer on screen, so naming it would report a
    // failure for a search nobody is waiting on.
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(
              Object.assign(new Error('aborted'), { name: 'AbortError' }),
            ),
          );
        }),
    );
    const { result, rerender } = renderHook(
      ({ term }: { term: string }) => useRecordsSource(term, true),
      { initialProps: { term: 'acme' } },
    );
    await settle();

    rerender({ term: 'acmee' });
    await settle();

    expect(groupsOf(result.current)[0].unavailable).toBeUndefined();
    expect(groupsOf(result.current)[0].isLoading).toBe(true);
  });
});
