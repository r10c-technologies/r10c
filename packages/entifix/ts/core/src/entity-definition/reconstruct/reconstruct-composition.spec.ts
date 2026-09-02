import { describe, expect, it } from 'vitest';

import {
  accessor,
  cloneEntityDraft,
  Entity,
  entity,
  EntityId,
  newRowKey,
  reconstructEntity,
  ROW_KEY,
} from '../../index.js';

class Line {
  #sku = '';
  #quantity = 0;

  constructor(sku = '', quantity = 0) {
    this.#sku = sku;
    this.#quantity = quantity;
  }

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
}

@entity({ key: 'order' })
class Order implements Entity {
  #id?: EntityId;
  #reference = '';
  #lines: readonly Line[] = [];

  @accessor({ type: 'id', label: 'ID' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', label: 'Reference' })
  get reference(): string {
    return this.#reference;
  }
  set reference(value: string) {
    this.#reference = value;
  }

  @accessor({ type: 'composition', childType: () => Line, label: 'Lines' })
  get lines(): readonly Line[] {
    return this.#lines;
  }
  set lines(value: readonly Line[]) {
    this.#lines = value;
  }
}

/** A composition a copy must not carry. */
@entity({ key: 'batch' })
class Batch implements Entity {
  #id?: EntityId;
  #lines: readonly Line[] = [];

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
    label: 'Lines',
    resetOnClone: true,
  })
  get lines(): readonly Line[] {
    return this.#lines;
  }
  set lines(value: readonly Line[]) {
    this.#lines = value;
  }
}

/** The two composition members a form may never write back. */
@entity({ key: 'ledger' })
class Ledger implements Entity {
  #id?: EntityId;
  #posted: readonly Line[] = [];
  #undeclared: readonly Line[] = [];

  @accessor({ type: 'id', label: 'ID' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  /** Server-owned rows: shown, never written from a draft. */
  @accessor({
    type: 'composition',
    childType: () => Line,
    label: 'Posted',
    readonly: true,
  })
  get posted(): readonly Line[] {
    return this.#posted;
  }
  set posted(value: readonly Line[]) {
    this.#posted = value;
  }

  /** A composition that named no child — nothing to coerce a row against. */
  @accessor({ type: 'composition', label: 'Undeclared' })
  get undeclared(): readonly Line[] {
    return this.#undeclared;
  }
  set undeclared(value: readonly Line[]) {
    this.#undeclared = value;
  }
}

const row = (sku: string, quantity: string) => ({
  [ROW_KEY]: newRowKey(),
  sku,
  quantity,
});

describe('reconstructEntity — owned collections', () => {
  it('rebuilds each row through the child’s own accessors', () => {
    const order = reconstructEntity(Order, {
      reference: 'A-1',
      lines: [row('SPR-001', '2'), row('SPR-002', '5')],
    });

    expect(order.lines.map(line => [line.sku, line.quantity])).toEqual([
      ['SPR-001', 2],
      ['SPR-002', 5],
    ]);
  });

  it('writes rows that are real child instances, not the draft objects', () => {
    const order = reconstructEntity(Order, { lines: [row('SPR-001', '2')] });

    // The draft's members are strings; a child's are coerced. If the array were
    // passed through, `quantity` would still be `'2'` and the serializer would
    // write a string into a numeric column.
    expect(typeof order.lines[0]?.quantity).toBe('number');
    expect(ROW_KEY in (order.lines[0] as object)).toBe(false);
  });

  it('writes an explicitly empty list, which is a user who removed every row', () => {
    const order = reconstructEntity(Order, { lines: [] });

    expect(order.lines).toEqual([]);
  });

  it('leaves the record’s own rows alone when the draft holds none', () => {
    // The failure this prevents is a save that touches one scalar and silently
    // blanks the lines, because the draft that was submitted predates the
    // member or came back from storage unreadable.
    const existing = new Order();
    existing.lines = [new Line('SPR-001', 2)];

    const order = reconstructEntity(Order, { reference: 'A-1' }, { existing });

    expect(order.lines).toEqual([]);
    expect(reconstructEntity(Order, { lines: '' }).lines).toEqual([]);
  });

  it('skips a draft value that is not a readable row list', () => {
    const order = reconstructEntity(Order, { lines: 'two lines' });

    expect(order.lines).toEqual([]);
  });

  it('never writes a read-only collection, however the draft was filled', () => {
    const ledger = reconstructEntity(Ledger, { posted: [row('A', '1')] });

    expect(ledger.posted).toEqual([]);
  });

  it('skips a composition that declared no child, having nothing to build', () => {
    const ledger = reconstructEntity(Ledger, { undeclared: [row('A', '1')] });

    expect(ledger.undeclared).toEqual([]);
  });

  it('never assigns a coerced string to the collection itself', () => {
    // `isWritableScalar` must go on refusing `composition`: the scalar walk
    // writing here is how a member holding rows gets a string written over it.
    const order = reconstructEntity(Order, { lines: [row('A', '1')] });

    expect(Array.isArray(order.lines)).toBe(true);
  });
});

describe('cloneEntityDraft — owned collections', () => {
  it('re-keys every copied row', () => {
    const original = { lines: [row('SPR-001', '2')] };

    const copy = cloneEntityDraft(Order, original);

    const copied = (copy['lines'] as { $key: string }[])[0];
    const source = original.lines[0];
    expect(copied?.$key).not.toBe(source?.[ROW_KEY]);
    expect(copied).toMatchObject({ sku: 'SPR-001', quantity: '2' });
  });

  it('empties a resetOnClone collection to a list, never to a string', () => {
    // Cleared to `''` the member would not be a readable row list, so
    // `reconstructEntity` would skip it — and the "reset" collection would come
    // back holding the original's lines.
    const copy = cloneEntityDraft(Batch, { lines: [row('SPR-001', '2')] });

    expect(copy['lines']).toEqual([]);
    expect(reconstructEntity(Batch, copy).lines).toEqual([]);
  });

  it('leaves the original draft’s rows untouched', () => {
    const original = { lines: [row('SPR-001', '2')] };
    const before = JSON.stringify(original);

    cloneEntityDraft(Order, original);

    expect(JSON.stringify(original)).toBe(before);
  });
});
