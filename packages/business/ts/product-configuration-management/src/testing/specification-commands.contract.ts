import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProductSpecification } from '../entities/product-specification';
import type { SpecificationCommands } from '../ports/offering-catalog';

const named = (name: string) => {
  const specification = new ProductSpecification();
  specification.name = name;
  return specification;
};

/**
 * What every {@link SpecificationCommands} must guarantee, through the port
 * alone: each create in an organization draws the next code of that
 * organization's counter, a repeated `Idempotency-Key` answers the record the
 * first create wrote without drawing another, and every record answered has
 * the id it was stored under.
 *
 * `make` returns a fresh subject over the organizations `CONTRACT_OFFERINGS`
 * names, each with its own store.
 */
export const describeSpecificationCommandsContract = (
  name: string,
  make: () => SpecificationCommands | Promise<SpecificationCommands>,
) => {
  describe(`${name} honours the SpecificationCommands contract`, () => {
    it('draws consecutive codes per organization', async () => {
      const commands = await make();

      const created = await Effect.runPromise(
        Effect.all([
          commands.create('acme', named('A'), undefined),
          commands.create('acme', named('B'), undefined),
          commands.create('other', named('C'), undefined),
        ]),
      );

      expect(created.map(one => one.code)).toEqual([
        'product-001',
        'product-002',
        'product-001',
      ]);
      expect(created.every(one => typeof one.id === 'string')).toBe(true);
    });

    it('answers a repeated key with the first record, drawing no code', async () => {
      const commands = await make();

      const first = await Effect.runPromise(
        commands.create('acme', named('A'), 'key-1'),
      );
      const again = await Effect.runPromise(
        commands.create('acme', named('A'), 'key-1'),
      );
      const next = await Effect.runPromise(
        commands.create('acme', named('B'), 'key-2'),
      );

      expect(again).toMatchObject({ id: first.id, code: first.code });
      expect(next.code).toBe('product-002');
    });
  });
};
