import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { CatalogImport } from '../entities/catalog-import';
import { ProductOffering } from '../entities/product-offering';
import { ProductOfferingPrice } from '../entities/product-offering-price';
import { ProductSpecification } from '../entities/product-specification';
import type {
  CatalogImportCommands,
  ImportedRow,
} from '../ports/catalog-import';

/** One row's records, as the import builds them before the store numbers them. */
export const importedRowOf = (
  name: string,
  seal: ImportedRow['seal'] = () => Effect.succeed(undefined),
): ImportedRow => {
  const specification = new ProductSpecification('', name);
  specification.id = globalThis.crypto.randomUUID();
  specification.version = 1;
  specification.lifecycleStatus = 'in-design';
  const offering = new ProductOffering(name, String(specification.id));
  offering.id = globalThis.crypto.randomUUID();
  offering.revision = 1;
  const price = new ProductOfferingPrice(String(offering.id), 1500, 'GTQ');
  price.id = globalThis.crypto.randomUUID();
  price.revision = 1;
  return { specification, offering, price, seal };
};

/**
 * What every {@link CatalogImportCommands} must guarantee, through the port
 * alone (ADR 0084 §4): a row draws the organization's next code before it is
 * sealed, a key writes once and answers what it wrote ever after, and an
 * import's record is written once under its id.
 */
export const describeCatalogImportCommandsContract = (
  name: string,
  make: () => CatalogImportCommands | Promise<CatalogImportCommands>,
) => {
  describe(`${name} honours the CatalogImportCommands contract`, () => {
    it('draws the next code before the row is sealed, per organization', async () => {
      const commands = await make();
      const sealed: string[] = [];
      const seal: ImportedRow['seal'] = specification => {
        sealed.push(specification.code);
        return Effect.succeed(undefined);
      };

      const outcomes = await Effect.runPromise(
        Effect.all([
          commands.importRow('acme', 'k:2', importedRowOf('A', seal)),
          commands.importRow('acme', 'k:3', importedRowOf('B', seal)),
          commands.importRow('other', 'k:2', importedRowOf('C', seal)),
        ]),
      );

      expect(sealed).toEqual(['product-001', 'product-002', 'product-001']);
      expect(outcomes.map(one => one.outcome)).toEqual([
        'created',
        'created',
        'created',
      ]);
    });

    it('answers a repeated key with what it wrote, drawing no code', async () => {
      const commands = await make();
      const first = importedRowOf('A');

      const created = await Effect.runPromise(
        commands.importRow('acme', 'k:2', first),
      );
      const before = await Effect.runPromise(commands.claimed('acme', 'k:9'));
      const claimed = await Effect.runPromise(commands.claimed('acme', 'k:2'));
      const again = await Effect.runPromise(
        commands.importRow('acme', 'k:2', importedRowOf('A')),
      );
      const next = importedRowOf('B');
      await Effect.runPromise(commands.importRow('acme', 'k:3', next));

      expect(created).toEqual({
        outcome: 'created',
        specificationId: String(first.specification.id),
        offeringId: String(first.offering.id),
      });
      expect(before).toBeUndefined();
      expect(claimed).toMatchObject({
        specificationId: created.specificationId,
        offeringId: created.offeringId,
      });
      expect(again).toEqual({ ...created, outcome: 'replayed' });
      expect(next.specification.code).toBe('product-002');
    });

    it('keeps one key per organization', async () => {
      const commands = await make();

      await Effect.runPromise(
        commands.importRow('acme', 'k:2', importedRowOf('A')),
      );
      const elsewhere = await Effect.runPromise(
        commands.claimed('other', 'k:2'),
      );

      expect(elsewhere).toBeUndefined();
    });

    it('writes an import record once, under its id', async () => {
      const commands = await make();
      const first = new CatalogImport('first.csv');
      first.id = 'import-1';
      first.rowCount = 2;
      const second = new CatalogImport('second.csv');
      second.id = 'import-1';

      const written = await Effect.runPromise(commands.record('acme', first));
      const again = await Effect.runPromise(commands.record('acme', second));

      expect(written.fileName).toBe('first.csv');
      expect(again.fileName).toBe('first.csv');
      expect(again.rowCount).toBe(2);
    });
  });
};
