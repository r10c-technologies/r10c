import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProductSpecification } from '../entities/product-specification';
import type { SpecificationCommands } from '../ports/offering-catalog';

const named = (name: string) => {
  const specification = new ProductSpecification();
  specification.name = name;
  specification.version = 1;
  specification.lifecycleStatus = 'in-design';
  return specification;
};

/** The same record, as a decision has moved it, at a release moment. */
const movedTo = (
  specification: ProductSpecification,
  status: NonNullable<ProductSpecification['lifecycleStatus']>,
  at = new Date('2026-11-19T10:00:00.000Z'),
) => {
  specification.lifecycleStatus = status;
  if (status === 'active') specification.validFrom = at;
  return specification;
};

/** The next version of a series, as `revise` builds it. */
const nextOf = (specification: ProductSpecification) => {
  const next = new ProductSpecification(specification.code, specification.name);
  next.id = globalThis.crypto.randomUUID();
  next.specKey = specification.specKey;
  next.version = Number(specification.version) + 1;
  next.lifecycleStatus = 'in-design';
  return next;
};

/**
 * What every {@link SpecificationCommands} must guarantee, through the port
 * alone: each create in an organization draws the next code of that
 * organization's counter and starts a series under it, a repeated
 * `Idempotency-Key` answers the record the first create wrote without drawing
 * another, every record answered has the id it was stored under — and every
 * lifecycle move, next version and delete is conditional on what it read
 * (ADR 0079 §1).
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

    it('starts a series: the key is the code, at revision 1', async () => {
      const commands = await make();

      const created = await Effect.runPromise(
        commands.create('acme', named('A'), undefined),
      );

      expect(created).toMatchObject({
        specKey: 'product-001',
        version: 1,
        lifecycleStatus: 'in-design',
        revision: 1,
      });
    });

    it('moves a version only from the state it was read in', async () => {
      const commands = await make();
      const created = await Effect.runPromise(
        commands.create('acme', named('A'), undefined),
      );

      const released = await Effect.runPromise(
        commands.move('acme', movedTo(created, 'active'), 'in-design'),
      );
      // A second release read the same `in-design` and lost the race.
      const again = await Effect.runPromise(
        commands.move('acme', movedTo(created, 'active'), 'in-design'),
      );

      expect([released, again]).toEqual(['committed', 'changed']);
      expect(created.revision).toBe(2);
    });

    it('retires the version a release replaces, so one is active per key', async () => {
      const commands = await make();
      const first = await Effect.runPromise(
        commands.create('acme', named('A'), undefined),
      );
      await Effect.runPromise(
        commands.move('acme', movedTo(first, 'active'), 'in-design'),
      );
      const second = nextOf(first);
      await Effect.runPromise(commands.revise('acme', second));

      await Effect.runPromise(
        commands.move('acme', movedTo(second, 'active'), 'in-design'),
      );

      // The first is no longer active: retiring it from `active` misses, and
      // making it obsolete from `retired` lands.
      expect(
        await Effect.runPromise(
          commands.move('acme', movedTo(first, 'retired'), 'active'),
        ),
      ).toBe('changed');
      expect(
        await Effect.runPromise(
          commands.move('acme', movedTo(first, 'obsolete'), 'retired'),
        ),
      ).toBe('committed');
    });

    it('refuses a second version under one number', async () => {
      const commands = await make();
      const first = await Effect.runPromise(
        commands.create('acme', named('A'), undefined),
      );

      const outcomes = await Effect.runPromise(
        Effect.all([
          commands.revise('acme', nextOf(first)),
          commands.revise('acme', nextOf(first)),
        ]),
      );

      expect(outcomes).toEqual(['committed', 'changed']);
    });

    it('deletes a version only while it is in design', async () => {
      const commands = await make();
      const draft = await Effect.runPromise(
        commands.create('acme', named('A'), undefined),
      );
      const frozen = await Effect.runPromise(
        commands.create('acme', named('B'), undefined),
      );
      await Effect.runPromise(
        commands.move('acme', movedTo(frozen, 'active'), 'in-design'),
      );

      const outcomes = await Effect.runPromise(
        Effect.all([
          commands.remove('acme', String(draft.id)),
          commands.remove('acme', String(draft.id)),
          commands.remove('acme', String(frozen.id)),
        ]),
      );

      expect(outcomes).toEqual(['removed', 'absent', 'changed']);
    });
  });
};
