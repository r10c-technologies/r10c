import { describe, expect, it } from 'vitest';

import {
  accessor,
  describeChildColumns,
  editableChildColumns,
  EntifixBuildError,
  reconstructChild,
  ROW_KEY,
} from '../../index.js';

/** A composition child: accessors, no `@entity()`, no id. */
class Line {
  #sku = '';
  #quantity = 0;
  #shipped = false;
  #due?: Date;
  #tags: readonly string[] = [];
  #total = 0;

  @accessor({ type: 'string', label: 'SKU' })
  get sku(): string {
    return this.#sku;
  }
  set sku(value: string) {
    this.#sku = value;
  }

  @accessor({ type: 'number', label: 'Quantity' })
  get quantity(): number {
    return this.#quantity;
  }
  set quantity(value: number) {
    this.#quantity = value;
  }

  @accessor({ type: 'boolean', label: 'Shipped' })
  get shipped(): boolean {
    return this.#shipped;
  }
  set shipped(value: boolean) {
    this.#shipped = value;
  }

  @accessor({ type: 'date', label: 'Due' })
  get due(): Date | undefined {
    return this.#due;
  }
  set due(value: Date | undefined) {
    this.#due = value;
  }

  @accessor({ type: 'scalarCollection', label: 'Tags' })
  get tags(): readonly string[] {
    return this.#tags;
  }
  set tags(value: readonly string[]) {
    this.#tags = value;
  }

  /** Server-owned: shown, never written back from a cell. */
  @accessor({ type: 'number', label: 'Total', readonly: true })
  get total(): number {
    return this.#total;
  }
  set total(value: number) {
    this.#total = value;
  }
}

/** A child whose storage column differs from its property. */
class Aliased {
  #quantity = 0;

  @accessor({ type: 'number', label: 'Quantity', alias: 'qty' })
  get quantity(): number {
    return this.#quantity;
  }
  set quantity(value: number) {
    this.#quantity = value;
  }
}

/**
 * A child that owns rows of its own, and one that names another record.
 *
 * Both are skipped rather than coerced: `reconstructChild` is one level deep by
 * decision, and a relation's draft value is a foreign key no grid cell edits.
 */
class Nested {
  #sku = '';
  #parts: readonly Line[] = [];

  @accessor({ type: 'string', label: 'SKU' })
  get sku(): string {
    return this.#sku;
  }
  set sku(value: string) {
    this.#sku = value;
  }

  @accessor({ type: 'composition', childType: () => Line, label: 'Parts' })
  get parts(): readonly Line[] {
    return this.#parts;
  }
  set parts(value: readonly Line[]) {
    this.#parts = value;
  }
}

class Colliding {
  #key = '';

  @accessor({ type: 'string', label: 'Key' })
  get $key(): string {
    return this.#key;
  }
  set $key(value: string) {
    this.#key = value;
  }
}

describe('describeChildColumns', () => {
  it('describes a value class that carries no @entity()', () => {
    expect(describeChildColumns(Line).map(column => column.name)).toEqual([
      'sku',
      'quantity',
      'shipped',
      'due',
      'tags',
      'total',
    ]);
  });

  it('refuses a child that declares the reserved row key', () => {
    // A member of this name would be overwritten by the row's own identity, so
    // the row would re-key on every keystroke and address another row's errors.
    expect(() => describeChildColumns(Colliding)).toThrow(EntifixBuildError);
  });

  it('names the reserved member in the failure', () => {
    expect(() => describeChildColumns(Colliding)).toThrow(ROW_KEY);
  });
});

describe('editableChildColumns', () => {
  it('keeps a read-only member, which a grid still shows', () => {
    const names = editableChildColumns(describeChildColumns(Line)).map(
      column => column.name,
    );

    expect(names).toContain('total');
  });
});

describe('reconstructChild', () => {
  it('coerces each member with the same rules the master uses', () => {
    const line = reconstructChild(Line, {
      [ROW_KEY]: 'r1',
      sku: 'SPR-001',
      quantity: '3',
      shipped: 'true',
      due: '2026-09-02',
      tags: 'a,b',
    });

    expect(line.sku).toBe('SPR-001');
    expect(line.quantity).toBe(3);
    expect(line.shipped).toBe(true);
    expect(line.due).toEqual(new Date('2026-09-02'));
    expect(line.tags).toEqual(['a', 'b']);
  });

  it('never writes the row key onto the child', () => {
    // The key is the browser's identity for the row, not the entity's data —
    // writing it would put a member on the wire the entity never declared.
    const line = reconstructChild(Line, { [ROW_KEY]: 'r1', sku: 'A' });

    expect(ROW_KEY in line).toBe(false);
  });

  it('reads a cleared checkbox as false, not as absent', () => {
    const line = reconstructChild(Line, { [ROW_KEY]: 'r1', shipped: '' });

    expect(line.shipped).toBe(false);
  });

  it('leaves a blank number undefined rather than making it zero', () => {
    const line = reconstructChild(Line, { [ROW_KEY]: 'r1', quantity: '' });

    expect(line.quantity).toBeUndefined();
  });

  it('reads a cleared collection as an empty list', () => {
    const line = reconstructChild(Line, { [ROW_KEY]: 'r1', tags: '' });

    expect(line.tags).toEqual([]);
  });

  it('skips a read-only member', () => {
    const line = reconstructChild(Line, { [ROW_KEY]: 'r1', total: '99' });

    expect(line.total).toBe(0);
  });

  it('assigns by accessor name, never by the storage column', () => {
    // `key` is `alias ?? name`; the alias is applied by the serializer on the
    // way out, so assigning by it here would write nothing at all.
    const row = reconstructChild(Aliased, { [ROW_KEY]: 'r1', quantity: '4' });

    expect(row.quantity).toBe(4);
  });

  it('leaves a nested collection alone rather than coercing a string onto it', () => {
    // One level deep by decision: a grid inside a grid is not built, so the
    // member keeps whatever the constructor gave it instead of being cleared.
    const nested = reconstructChild(Nested, { [ROW_KEY]: 'r1', sku: 'A' });

    expect(nested.sku).toBe('A');
    expect(nested.parts).toEqual([]);
  });

  it('drops a nested collection from the editable columns', () => {
    const names = editableChildColumns(describeChildColumns(Nested)).map(
      column => column.name,
    );

    expect(names).toEqual(['sku']);
  });

  it('reads a member the row never held as absent, exactly as the master does', () => {
    // `reconstructEntity` writes every writable member from `values[name] ?? ''`
    // too, so an absent key means "empty" on a row for the same reason it does
    // on a record. A row is seeded from the child's own descriptors, so a
    // missing key is a malformed row rather than a member left alone — and the
    // two walks agreeing is what keeps a child's `number` meaning one thing.
    const line = reconstructChild(Line, { [ROW_KEY]: 'r1' });

    expect(line.sku).toBeUndefined();
    expect(line.quantity).toBeUndefined();
  });
});
