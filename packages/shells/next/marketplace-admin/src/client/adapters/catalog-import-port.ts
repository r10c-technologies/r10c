import { EntityRepositoryTag } from '@entifix/business';
import type { Entity } from '@entifix/core';
import type { ImportReference } from '@r10c/business-ts-product-configuration-management';
import { Effect } from 'effect';
import type { Context } from 'effect/Context';
import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/browser';

import type {
  CatalogImportOutcome,
  CatalogImportPort,
  ImportTable,
} from '../client-types';

/** Where the import verb is served, through the catalog's same-origin proxy. */
export const CATALOG_IMPORT_URL = '/api/admin/catalog-import/import';

/** One page of a reference list; the vocabulary is small, so a few at most. */
const PAGE_SIZE = 500;

/**
 * Every active record of one reference list, by name: the brands, categories
 * and phone models a sheet may cite. A retired one is not offered by any
 * picker, so a sheet naming it is refused the same way.
 */
const activeNames = (repository: Context<EntityRepositoryTag>) =>
  Effect.gen(function* () {
    const store = yield* EntityRepositoryTag;
    const names: ImportReference[] = [];
    for (let page = 1; ; page += 1) {
      const { items } = yield* store.load<
        Entity & { name?: string; status?: string }
      >({
        filtering: [{ property: 'status', operator: 'eq', value: 'active' }],
        page,
        pageSize: PAGE_SIZE,
      });
      for (const item of items)
        names.push({ id: String(item.id), name: String(item.name ?? '') });
      if (items.length < PAGE_SIZE) return names;
    }
  }).pipe(Effect.provide(repository));

/** A `.xlsx` by its name or its type; anything else is read as text. */
const isWorkbook = (file: File) =>
  file.name.toLowerCase().endsWith('.xlsx') ||
  file.type ===
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * A sheet's cells. A workbook's numbers are kept as the text the file holds,
 * so `12.5` is never read back through a float; a CSV's delimiter is sniffed,
 * since a spreadsheet saved in a Spanish locale writes `;`.
 */
export const readImportTable = async (file: File): Promise<ImportTable> => {
  if (isWorkbook(file)) return readSheet(file, { parseNumber: text => text });
  const parsed = Papa.parse<string[]>(await file.text(), {
    skipEmptyLines: 'greedy',
  });
  return parsed.data;
};

/** The refusal's `code`, from a problem body; `unexpected` when it has none. */
const codeOf = async (response: Response): Promise<string> => {
  const body = (await response.json().catch(() => undefined)) as
    { readonly code?: unknown } | undefined;
  return typeof body?.code === 'string' ? body.code : 'unexpected';
};

/**
 * The catalog import's browser half, over the catalog's reference lists and
 * the import route (ADR 0084). `fetcher` is the global `fetch` in a browser.
 */
export const makeCatalogImportPort = (options: {
  readonly brands: Context<EntityRepositoryTag>;
  readonly categories: Context<EntityRepositoryTag>;
  readonly deviceModels: Context<EntityRepositoryTag>;
  readonly fetcher?: typeof fetch;
}): CatalogImportPort => ({
  readTable: readImportTable,
  references: () =>
    Effect.runPromise(
      Effect.all({
        brands: activeNames(options.brands),
        categories: activeNames(options.categories),
        deviceModels: activeNames(options.deviceModels),
      }),
    ),
  submit: async (key, payload): Promise<CatalogImportOutcome> => {
    const response = await (options.fetcher ?? fetch)(CATALOG_IMPORT_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // An RFC 9651 String: the import's id and the root of every row's
        // claim, minted once per sheet and kept in the wizard's draft.
        'idempotency-key': `"${key}"`,
      },
      body: JSON.stringify(payload),
    }).catch(() => undefined);
    if (response === undefined) return { ok: false, code: 'unexpected' };
    if (!response.ok) return { ok: false, code: await codeOf(response) };
    const body = (await response.json()) as {
      readonly data: { readonly id: string };
    };
    return { ok: true, id: body.data.id };
  },
});
