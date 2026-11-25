import { deserializeSingleEntity, serializeEntity } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { CatalogImport } from './catalog-import.entity.js';
import { ImportRejectionRow } from './import-rejection-row.js';

describe('CatalogImport', () => {
  it('round-trips every member through its envelope, rejections included', async () => {
    const record = new CatalogImport('catalog.xlsx');
    record.id = 'import-1';
    record.mode = 'publish';
    record.status = 'partial';
    record.importedAt = new Date('2026-11-25T10:00:00.000Z');
    record.rowCount = 3;
    record.createdCount = 2;
    record.rejectedCount = 1;
    record.rejections = [new ImportRejectionRow(4, 'importDuplicate', 'name')];

    const revived = (await Effect.runPromise(
      deserializeSingleEntity(
        CatalogImport,
        serializeEntity(CatalogImport, record),
      ),
    )) as CatalogImport;

    expect(revived).toMatchObject({
      id: 'import-1',
      fileName: 'catalog.xlsx',
      mode: 'publish',
      status: 'partial',
      rowCount: 3,
      createdCount: 2,
      rejectedCount: 1,
    });
    expect(revived.importedAt?.toISOString()).toBe('2026-11-25T10:00:00.000Z');
    expect(revived.rejections).toEqual([
      expect.objectContaining({
        rowNumber: 4,
        code: 'importDuplicate',
        column: 'name',
      }),
    ]);
  });

  it('keeps a rejection as a plain value, with no id of its own', () => {
    const row = new ImportRejectionRow();
    row.rowNumber = 7;
    row.code = 'importCellInvalid';
    row.column = undefined;

    expect([row.rowNumber, row.code, row.column]).toEqual([
      7,
      'importCellInvalid',
      undefined,
    ]);
  });
});
