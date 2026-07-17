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
    expect(serializeEntity(Brand, brand)).toEqual({ id: 'brand-1', name: 'Acme' });
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
      })
    ).then((instance) => {
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
      })
    ).then((instance) => {
      expect(serializeEntity(Product, instance as Product)).toEqual({
        id: 'product-2',
        name: 'Gadget',
        brand: 'brand-9',
      });
    }));
});
