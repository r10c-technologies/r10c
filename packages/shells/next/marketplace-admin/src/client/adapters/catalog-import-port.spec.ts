import { EntityRepositoryTag } from '@entifix/business';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { Context } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import {
  CATALOG_IMPORT_URL,
  citedAs,
  makeCatalogImportPort,
  readImportTable,
} from './catalog-import-port.js';

vi.mock('read-excel-file/browser', () => ({
  readSheet: vi.fn(
    (_file: File, options: { parseNumber: (text: string) => unknown }) =>
      Promise.resolve([
        ['Nombre', 'Precio'],
        ['Tornillo', options.parseNumber('1.5')],
      ]),
  ),
}));

const listOf = (records: { id: string; name: string; status: string }[]) =>
  Context.make(
    EntityRepositoryTag,
    makeInMemoryEntityRepository(records as never),
  );

const respond = (status: number, body: unknown) =>
  vi.fn(() =>
    Promise.resolve(
      new Response(body === undefined ? 'not json' : JSON.stringify(body), {
        status,
      }),
    ),
  );

const portWith = (fetcher: typeof fetch) =>
  makeCatalogImportPort({
    brands: listOf([
      { id: 'b-1', name: 'Truper', status: 'active' },
      { id: 'b-2', name: 'Gone', status: 'retired' },
    ]),
    categories: listOf([]),
    deviceModels: listOf([{ id: 'd-1', name: 'iPhone 15', status: 'active' }]),
    fetcher,
  });

describe('reading a sheet', () => {
  it('reads a CSV in either delimiter, dropping empty lines', async () => {
    const comma = await readImportTable(
      new File(['Nombre,Precio\nTornillo,1.50\n\n'], 'a.csv'),
    );
    const semicolon = await readImportTable(
      new File(['Nombre;Precio\nClavo;"0,25"\n'], 'b.csv', {
        type: 'text/csv',
      }),
    );

    expect(comma).toEqual([
      ['Nombre', 'Precio'],
      ['Tornillo', '1.50'],
    ]);
    expect(semicolon).toEqual([
      ['Nombre', 'Precio'],
      ['Clavo', '0,25'],
    ]);
  });

  it('reads a workbook by name or by type, keeping its numbers as text', async () => {
    const named = await readImportTable(new File(['x'], 'catalogo.XLSX'));
    const typed = await readImportTable(
      new File(['x'], 'catalogo', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );

    expect(named).toEqual([
      ['Nombre', 'Precio'],
      ['Tornillo', '1.5'],
    ]);
    expect(typed).toEqual(named);
  });
});

describe('the reference names', () => {
  it('lists only the active ones, by id and name', async () => {
    const references = await portWith(respond(200, {})).references();

    expect(references).toEqual({
      brands: [{ id: 'b-1', name: 'Truper' }],
      categories: [],
      deviceModels: [{ id: 'd-1', name: 'iPhone 15' }],
    });
  });

  it('reads every page of a long list', async () => {
    const many = Array.from({ length: 501 }, (_, index) => ({
      id: `b-${String(index)}`,
      name: `Brand ${String(index)}`,
      status: 'active',
    }));
    const port = makeCatalogImportPort({
      brands: listOf(many),
      // A record with no name is cited by nothing, never by `undefined`.
      categories: Context.make(
        EntityRepositoryTag,
        makeInMemoryEntityRepository([
          { id: 'c-1', status: 'active' },
        ] as never),
      ),
      deviceModels: listOf([]),
    });

    const references = await port.references();

    expect(references.brands).toHaveLength(501);
    // A record with no name is cited by nothing.
    expect(references.categories).toEqual([]);
  });
});

describe('the names a record is cited by', () => {
  it('reads a plain name, every locale of a localized one, and nothing else', () => {
    expect(citedAs({ id: 'b-1', name: 'Truper' })).toEqual([
      { id: 'b-1', name: 'Truper' },
    ]);
    expect(
      citedAs({ id: 'c-1', name: { es: 'Tornillería', en: 'Screws', fr: 1 } }),
    ).toEqual([
      { id: 'c-1', name: 'Tornillería' },
      { id: 'c-1', name: 'Screws' },
    ]);
    expect(citedAs({ id: 'x', name: null })).toEqual([]);
  });
});

describe('submitting an import', () => {
  const payload = { fileName: 'a.csv', mode: 'draft' as const, rows: [] };

  it('posts the rows under the key, as an RFC 9651 string', async () => {
    const fetcher = respond(200, { data: { id: 'import-1' } });

    const outcome = await portWith(fetcher).submit('key-1', payload);

    expect(outcome).toEqual({ ok: true, id: 'import-1' });
    expect(fetcher).toHaveBeenCalledWith(CATALOG_IMPORT_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': '"key-1"',
      },
      body: JSON.stringify(payload),
    });
  });

  it('posts through the global fetch when it was handed none', async () => {
    const fetcher = respond(200, { data: { id: 'import-2' } });
    vi.stubGlobal('fetch', fetcher);
    const port = makeCatalogImportPort({
      brands: listOf([]),
      categories: listOf([]),
      deviceModels: listOf([]),
    });

    expect(await port.submit('k', payload)).toEqual({
      ok: true,
      id: 'import-2',
    });
    vi.unstubAllGlobals();
  });

  it('answers a refusal by its code, and anything else as unexpected', async () => {
    const refused = await portWith(
      respond(400, { code: 'importTooLarge' }),
    ).submit('k', payload);
    const unreadable = await portWith(respond(500, undefined)).submit(
      'k',
      payload,
    );
    const unreachable = await portWith(
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    ).submit('k', payload);

    expect([refused, unreadable, unreachable]).toEqual([
      { ok: false, code: 'importTooLarge' },
      { ok: false, code: 'unexpected' },
      { ok: false, code: 'unexpected' },
    ]);
  });
});
