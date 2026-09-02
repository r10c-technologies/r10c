import { Effect } from 'effect';

import {
  accessor,
  deserializeSingleEntity,
  Entity,
  entity,
  EntityId,
  EntityLink,
  serializeEntity,
} from '../../index.js';

@entity({ key: 'brand' })
class Brand implements Entity {
  #id?: EntityId;
  #name?: string;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor()
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }
}

@entity({ key: 'product' })
class Product implements Entity {
  #id?: EntityId;
  #name?: string;
  #brand = new EntityLink(Brand);

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor()
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }

  @accessor()
  get brand(): EntityLink<Brand> {
    return this.#brand;
  }
}

describe('serializeEntity', () => {
  it('serializes scalar accessors keyed by name, omitting undefined', () => {
    const brand = new Brand();
    brand.id = 'brand-1';
    brand.name = 'Acme';
    expect(serializeEntity(Brand, brand)).toEqual({
      id: 'brand-1',
      name: 'Acme',
    });
  });

  it('emits an embedded object for a loaded link', () => {
    const brand = new Brand();
    brand.id = 'brand-1';
    brand.name = 'Acme';
    const product = new Product();
    product.id = 'product-1';
    product.name = 'Widget';
    product.brand.setValue(brand);

    expect(serializeEntity(Product, product)).toEqual({
      id: 'product-1',
      name: 'Widget',
      brand: { id: 'brand-1', name: 'Acme' },
    });
  });

  it('emits the scalar id for a foreign-key link', () => {
    const product = new Product();
    product.id = 'product-2';
    product.name = 'Gadget';
    product.brand.setId('brand-9');

    expect(serializeEntity(Product, product)).toEqual({
      id: 'product-2',
      name: 'Gadget',
      brand: 'brand-9',
    });
  });

  it('round-trips through deserialize (embedded link)', () =>
    Effect.runPromise(
      deserializeSingleEntity(Product, {
        id: 'product-1',
        name: 'Widget',
        brand: { id: 'brand-1', name: 'Acme' },
      }),
    ).then(instance => {
      expect(serializeEntity(Product, instance as Product)).toEqual({
        id: 'product-1',
        name: 'Widget',
        brand: { id: 'brand-1', name: 'Acme' },
      });
    }));

  it('round-trips through deserialize (foreign-key link)', () =>
    Effect.runPromise(
      deserializeSingleEntity(Product, {
        id: 'product-2',
        name: 'Gadget',
        brand: 'brand-9',
      }),
    ).then(instance => {
      expect(serializeEntity(Product, instance as Product)).toEqual({
        id: 'product-2',
        name: 'Gadget',
        brand: 'brand-9',
      });
    }));
});

/**
 * A child of a `composition`: a **value**, so no `@entity()` and no `id`. It is
 * described entirely by its accessors, which is what lets one walk serialize an
 * entity and one row of the collection it owns.
 */
class Line {
  #sku: string;
  #quantity: number;

  constructor(sku = '', quantity = 0) {
    this.#sku = sku;
    this.#quantity = quantity;
  }

  @accessor({ type: 'string' })
  get sku(): string {
    return this.#sku;
  }
  set sku(value: string) {
    this.#sku = value;
  }

  @accessor({ type: 'number', alias: 'qty' })
  get quantity(): number {
    return this.#quantity;
  }
  set quantity(value: number) {
    this.#quantity = value;
  }
}

@entity({ key: 'invoice' })
class Invoice implements Entity {
  #id?: EntityId;
  #lines: readonly Line[] = [];

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'composition', childType: () => Line })
  get lines(): readonly Line[] {
    return this.#lines;
  }
  set lines(value: readonly Line[]) {
    this.#lines = value;
  }
}

describe('composition members', () => {
  /**
   * The whole reason the serializer had to learn about `composition`: a child's
   * state lives in its private fields, so passing the array through untouched
   * writes `[{}, {}]` and the rows never persist.
   */
  it('flattens each row through the child’s accessors', () => {
    const invoice = new Invoice();
    invoice.id = 'inv-1';
    invoice.lines = [new Line('SKU-1', 2), new Line('SKU-2', 5)];

    expect(serializeEntity(Invoice, invoice)).toEqual({
      id: 'inv-1',
      // `qty`, not `quantity` — a child's `alias` is its column name exactly as
      // an entity's is, which is what keeps the mapping layer non-existent.
      lines: [
        { sku: 'SKU-1', qty: 2 },
        { sku: 'SKU-2', qty: 5 },
      ],
    });
  });

  it('serializes a row that never went through the deserializer', () => {
    const invoice = new Invoice();
    // A fixture or a hand-built command payload: plain data, same document.
    invoice.lines = [{ sku: 'SKU-3', quantity: 1 } as Line];

    expect(serializeEntity(Invoice, invoice)).toEqual({
      lines: [{ sku: 'SKU-3', qty: 1 }],
    });
  });

  it('round-trips owned rows back into children', () =>
    Effect.runPromise(
      deserializeSingleEntity(Invoice, {
        id: 'inv-2',
        lines: [{ sku: 'SKU-9', qty: 3 }],
      }),
    ).then(instance => {
      const invoice = instance as Invoice;

      expect(invoice.lines[0]).toBeInstanceOf(Line);
      expect(invoice.lines[0]?.quantity).toBe(3);
      expect(serializeEntity(Invoice, invoice)).toEqual({
        id: 'inv-2',
        lines: [{ sku: 'SKU-9', qty: 3 }],
      });
    }));

  it('leaves a composition alone when the stored value is not an array', () =>
    Effect.runPromise(
      deserializeSingleEntity(Invoice, { id: 'inv-3', lines: 'nonsense' }),
    ).then(instance => {
      expect((instance as Invoice).lines).toEqual([]);
    }));

  it('passes a non-array through on the way out', () => {
    const invoice = new Invoice();
    invoice.lines = 'nonsense' as unknown as readonly Line[];

    expect(serializeEntity(Invoice, invoice)).toEqual({ lines: 'nonsense' });
  });
});
