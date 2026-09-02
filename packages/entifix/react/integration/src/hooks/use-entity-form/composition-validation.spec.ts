import {
  accessor,
  describeEntityColumns,
  type Entity,
  entity,
  type EntityDraft,
  type EntityFieldDescriptor,
  type EntityId,
  ROW_KEY,
  type StandardSchemaV1,
} from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import {
  composeEntityFormErrors,
  type EntityDraftMessages,
  restoreEntityDraft,
  seedEntityDraft,
  validateEntityDraft,
} from './use-entity-form.helpers.js';

class Line {
  #sku = '';
  #quantity = 0;
  #unit = 'unit';
  #due?: Date;
  #total = 0;

  @accessor({ type: 'string', label: 'SKU', required: true })
  get sku(): string {
    return this.#sku;
  }
  set sku(value: string) {
    this.#sku = value;
  }

  @accessor({ type: 'number', label: 'Cantidad' })
  get quantity(): number {
    return this.#quantity;
  }
  set quantity(value: number) {
    this.#quantity = value;
  }

  @accessor({ type: 'enum', label: 'Unidad', enumValues: ['unit', 'box'] })
  get unit(): string {
    return this.#unit;
  }
  set unit(value: string) {
    this.#unit = value;
  }

  @accessor({ type: 'date', label: 'Vence' })
  get due(): Date | undefined {
    return this.#due;
  }
  set due(value: Date | undefined) {
    this.#due = value;
  }

  @accessor({ type: 'number', label: 'Total', readonly: true })
  get total(): number {
    return this.#total;
  }
  set total(value: number) {
    this.#total = value;
  }
}

@entity({ key: 'validated-order' })
class Order implements Entity {
  #id?: EntityId;
  #lines: readonly Line[] = [];
  #bare: readonly Line[] = [];

  @accessor({ type: 'id', label: 'ID' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'composition',
    childType: () => Line,
    label: 'Líneas',
    required: true,
  })
  get lines(): readonly Line[] {
    return this.#lines;
  }
  set lines(value: readonly Line[]) {
    this.#lines = value;
  }

  /** A composition with no declared child: nothing to walk a row against. */
  @accessor({ type: 'composition', label: 'Sin declarar' })
  get bare(): readonly Line[] {
    return this.#bare;
  }
  set bare(value: readonly Line[]) {
    this.#bare = value;
  }
}

const descriptors = describeEntityColumns(Order);

const messages: EntityDraftMessages = {
  required: field => `${field} es obligatorio`,
  number: field => `${field} debe ser un número`,
  date: field => `${field} debe ser una fecha`,
  option: field => `${field} no es una opción válida`,
};

const row = (over: Record<string, string> = {}) => ({
  [ROW_KEY]: 'k1',
  sku: 'SPR-001',
  quantity: '2',
  unit: 'unit',
  due: '2026-09-02',
  total: '0',
  ...over,
});

const validate = (values: EntityDraft) =>
  validateEntityDraft(descriptors, values, messages);

describe('validateEntityDraft — owned collections', () => {
  it('reports a row member at its own path', () => {
    expect(validate({ lines: [row({ quantity: 'many' })] })).toEqual({
      'lines[0].quantity': 'Cantidad debe ser un número',
    });
  });

  it('names the row that failed, not just the member', () => {
    expect(
      validate({ lines: [row(), row({ [ROW_KEY]: 'k2', sku: '  ' })] }),
    ).toEqual({ 'lines[1].sku': 'SKU es obligatorio' });
  });

  it('applies each metadata rule the child declares', () => {
    expect(
      validate({
        lines: [row({ unit: 'crate', due: 'ayer', quantity: 'x' })],
      }),
    ).toEqual({
      'lines[0].quantity': 'Cantidad debe ser un número',
      'lines[0].unit': 'Unidad no es una opción válida',
      'lines[0].due': 'Vence debe ser una fecha',
    });
  });

  it('reads required on the collection as “at least one row”', () => {
    // A genuinely different fact from `required` on a child member, which is
    // per row: an order with three lines, one blank, is not an order with none.
    expect(validate({ lines: [] })).toEqual({
      lines: 'Líneas es obligatorio',
    });
  });

  it('checks the rows rather than the collection once there is one', () => {
    expect(validate({ lines: [row()] })).toEqual({});
  });

  it('skips a read-only child member, which no cell can satisfy', () => {
    expect(validate({ lines: [row({ total: 'no es número' })] })).toEqual({});
  });

  it('leaves an empty optional member alone', () => {
    expect(validate({ lines: [row({ quantity: '', due: '' })] })).toEqual({});
  });

  it('reads a member the row never held as empty', () => {
    // A row restored from a draft written before the child gained a member.
    expect(validate({ lines: [{ [ROW_KEY]: 'k1' }] })).toEqual({
      'lines[0].sku': 'SKU es obligatorio',
    });
  });

  it('reports nothing for a composition that declared no child', () => {
    expect(validate({ lines: [row()], bare: [row()] })).toEqual({});
  });

  it('reads an unreadable draft value as no rows', () => {
    expect(validate({ lines: '' })).toEqual({
      lines: 'Líneas es obligatorio',
    });
  });
});

describe('seedEntityDraft — owned collections', () => {
  it('seeds no rows for a composition that declared no child', () => {
    // There are no columns to walk, so there is nothing a row could be.
    const order = new Order();
    order.bare = [new Line()];

    expect(seedEntityDraft(descriptors, order)['bare']).toEqual([]);
  });

  it('seeds no rows for a member that does not hold an array', () => {
    const order = new Order();
    (order as unknown as Record<string, unknown>)['lines'] = 'two lines';

    expect(seedEntityDraft(descriptors, order)['lines']).toEqual([]);
  });
});

describe('composeEntityFormErrors — a schema rule on a row', () => {
  /** A schema whose issue names a row member positionally, as they all do. */
  const schema: StandardSchemaV1 = {
    '~standard': {
      version: 1,
      vendor: 'spec',
      validate: () => ({
        issues: [
          { message: 'validation.min', path: ['lines', 0, 'quantity'] },
          { message: 'validation.pattern', path: ['id'] },
        ],
      }),
    },
  };

  it('addresses the same cell the metadata rules do', () => {
    // The whole point of joining the path: a schema rule and a metadata rule
    // have to produce the same key or `composeEntityFormErrors` cannot merge
    // them and the grid cannot find either.
    const { fields } = composeEntityFormErrors({
      descriptors,
      values: { lines: [row()] },
      messages,
      schema,
      translateIssue: message => message,
    });

    expect(fields['lines[0].quantity']).toBe('validation.min');
  });

  it('leaves a top-level issue keyed by its member name', () => {
    const { fields } = composeEntityFormErrors({
      descriptors,
      values: { lines: [row()] },
      messages,
      schema,
      translateIssue: message => message,
    });

    expect(fields['id']).toBe('validation.pattern');
  });
});

describe('restoreEntityDraft — owned collections', () => {
  const seed = seedEntityDraft(descriptors, new Order());
  const byName = (name: string): EntityFieldDescriptor =>
    descriptors.find(
      descriptor => descriptor.name === name,
    ) as EntityFieldDescriptor;

  it('restores a readable row list over the seed', () => {
    const restored = restoreEntityDraft(descriptors, seed, {
      lines: [row()],
    });

    expect(restored['lines']).toEqual([row()]);
  });

  it.each([
    ['a string, from a build before the member held rows', ''],
    ['rows with no key', [{ sku: 'A' }]],
    ['null', null],
  ])('drops %s back to the seeded value', (_label, persisted) => {
    const restored = restoreEntityDraft(descriptors, seed, {
      lines: persisted as EntityDraft[string],
    });

    expect(restored['lines']).toEqual([]);
  });

  it('drops one unreadable member without losing the others', () => {
    // Per member, so one bad entry never costs the user the rest of the form.
    const restored = restoreEntityDraft(descriptors, seed, {
      lines: 'nonsense',
      id: 'order-1',
    });

    expect(restored).toEqual({ ...seed, id: 'order-1', lines: [] });
    expect(byName('lines').type).toBe('composition');
  });
});
