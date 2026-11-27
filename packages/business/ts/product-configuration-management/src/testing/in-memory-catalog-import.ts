import type { CatalogEvent } from '@r10c/business-ts-catalog-contracts';
import { Effect } from 'effect';

import type { CatalogImport } from '../entities/catalog-import';
import type {
  CatalogImportCommands,
  ImportedRow,
  ImportedRowOutcome,
  UpdatedRow,
} from '../ports/catalog-import';

/** What the in-memory store holds, for a spec to assert against. */
export interface InMemoryCatalogImportState {
  readonly rows: ReadonlyArray<
    ImportedRow & { readonly organizationId: string }
  >;
  readonly updated: ReadonlyArray<
    UpdatedRow & { readonly organizationId: string }
  >;
  readonly announced: readonly CatalogEvent[];
  readonly records: Map<string, CatalogImport>;
}

/**
 * A {@link CatalogImportCommands} held in memory: a code counter per
 * organization, the rows each key wrote, the records written, and the
 * revision each record an update moved now stands at — a record it never
 * moved is taken at the revision its caller read. It runs
 * `describeCatalogImportCommandsContract`.
 */
export const makeInMemoryCatalogImportCommands = (): CatalogImportCommands & {
  readonly state: InMemoryCatalogImportState;
} => {
  const counters = new Map<string, number>();
  const claims = new Map<string, ImportedRowOutcome>();
  const rows: Array<ImportedRow & { readonly organizationId: string }> = [];
  const updated: Array<UpdatedRow & { readonly organizationId: string }> = [];
  const revisions = new Map<string, number | undefined>();
  const announced: CatalogEvent[] = [];
  const records = new Map<string, CatalogImport>();
  const at = (organizationId: string, key: unknown) =>
    `${organizationId}/${String(key)}`;

  return {
    state: { rows, updated, announced, records },
    claimed: (organizationId, key) =>
      Effect.sync(() => claims.get(at(organizationId, key))),
    importRow: (organizationId, key, row) =>
      Effect.gen(function* () {
        const known = claims.get(at(organizationId, key));
        if (known !== undefined)
          return { ...known, outcome: 'replayed' as const };
        const next = (counters.get(organizationId) ?? 0) + 1;
        const { specification, offering } = row;
        specification.code = `product-${String(next).padStart(3, '0')}`;
        specification.specKey = specification.code;
        specification.revision = 1;
        const event = yield* row.seal(specification);
        counters.set(organizationId, next);
        if (event !== undefined) announced.push(event);
        rows.push({ ...row, organizationId });
        const outcome = {
          outcome: 'created' as const,
          change: 'create' as const,
          specificationId: String(specification.id),
          offeringId: String(offering.id),
        };
        claims.set(at(organizationId, key), outcome);
        return outcome;
      }),
    updateRow: (organizationId, key, row) =>
      Effect.sync(() => {
        const known = claims.get(at(organizationId, key));
        if (known !== undefined)
          return { ...known, outcome: 'replayed' as const };
        const { offering, price } = row;
        const current = (record: {
          readonly id?: unknown;
          revision?: number;
        }) =>
          revisions.has(at(organizationId, record.id))
            ? revisions.get(at(organizationId, record.id))
            : record.revision;
        const read = row.priceIsNew ? [offering] : [offering, price];
        if (read.some(record => current(record) !== record.revision))
          return 'changed' as const;
        revisions.set(
          at(organizationId, offering.id),
          (offering.revision ?? 0) + 1,
        );
        revisions.set(
          at(organizationId, price.id),
          row.priceIsNew ? 1 : (price.revision ?? 0) + 1,
        );
        if (row.event !== undefined) announced.push(row.event);
        updated.push({ ...row, organizationId });
        const outcome = {
          outcome: 'created' as const,
          change: 'update' as const,
          specificationId: offering.specificationId,
          offeringId: String(offering.id),
        };
        claims.set(at(organizationId, key), outcome);
        return outcome;
      }),
    record: (organizationId, catalogImport) =>
      Effect.sync(() => {
        const key = at(organizationId, catalogImport.id);
        const known = records.get(key);
        if (known !== undefined) return known;
        records.set(key, catalogImport);
        return catalogImport;
      }),
  };
};
