import type { CatalogEvent } from '@r10c/business-ts-catalog-contracts';
import { Effect } from 'effect';

import type { CatalogImport } from '../entities/catalog-import';
import type {
  CatalogImportCommands,
  ImportedRow,
  ImportedRowOutcome,
} from '../ports/catalog-import';

/** What the in-memory store holds, for a spec to assert against. */
export interface InMemoryCatalogImportState {
  readonly rows: ReadonlyArray<
    ImportedRow & { readonly organizationId: string }
  >;
  readonly announced: readonly CatalogEvent[];
  readonly records: Map<string, CatalogImport>;
}

/**
 * A {@link CatalogImportCommands} held in memory: a code counter per
 * organization, the rows each key wrote and the records written. It runs
 * `describeCatalogImportCommandsContract`.
 */
export const makeInMemoryCatalogImportCommands = (): CatalogImportCommands & {
  readonly state: InMemoryCatalogImportState;
} => {
  const counters = new Map<string, number>();
  const claims = new Map<string, ImportedRowOutcome>();
  const rows: Array<ImportedRow & { readonly organizationId: string }> = [];
  const announced: CatalogEvent[] = [];
  const records = new Map<string, CatalogImport>();
  const at = (organizationId: string, key: unknown) =>
    `${organizationId}/${String(key)}`;

  return {
    state: { rows, announced, records },
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
          specificationId: String(specification.id),
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
