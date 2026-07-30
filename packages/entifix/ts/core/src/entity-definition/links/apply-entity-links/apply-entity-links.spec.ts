import { describe, expect, it } from 'vitest';

import {
  accessor,
  applyEntityLinks,
  describeEntityColumns,
  Entity,
  entity,
  EntityCollectionLink,
  EntityId,
  EntityLink,
  seedEntityLinkSelection,
  serializeEntity,
} from '../../../index.js';

@entity({ key: 'brand' })
class Brand implements Entity {
  #id?: EntityId;
  #name?: string;

  constructor(id?: EntityId, name?: string) {
    this.#id = id;
    this.#name = name;
  }

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

@entity({ key: 'tag' })
class Tag implements Entity {
  #id?: EntityId;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

@entity({ key: 'product' })
class Product implements Entity {
  #id?: EntityId;
  #brand = new EntityLink(Brand);
  #category = new EntityLink(Brand);
  #tags = new EntityCollectionLink(Tag);
  /** Typed as a relation but never initialized — a declaration mistake. */
  #broken?: EntityLink<Brand>;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'link', linkSerialization: 'embedded' })
  get brand(): EntityLink<Brand> {
    return this.#brand;
  }

  @accessor({ type: 'link' })
  get category(): EntityLink<Brand> {
    return this.#category;
  }

  @accessor({ type: 'linkCollection' })
  get tags(): EntityCollectionLink<Tag> {
    return this.#tags;
  }

  @accessor({ type: 'link' })
  get broken(): EntityLink<Brand> | undefined {
    return this.#broken;
  }
}

const descriptors = describeEntityColumns(Product);

describe('applyEntityLinks', () => {
  it('inlines a picked target when the member travels embedded', () => {
    const product = new Product();
    const brand = new Brand('brand-1', 'Acme');

    applyEntityLinks(product, descriptors, { brand: 'brand-1' }, { brand });

    expect(product.brand.value).toBe(brand);
    expect(product.brand.isLoaded).toBe(true);
    // The whole point of the policy: the wire shape follows the declaration.
    expect(serializeEntity(Product, product)['brand']).toEqual({
      id: 'brand-1',
      name: 'Acme',
    });
  });

  // The serializer inlines whatever `isLoaded`, so an `id` member handed the
  // picked instance must still be reduced to its key — otherwise the wire shape
  // would depend on whether a picker happened to hold the target.
  it('keeps a foreign-key member scalar even when the instance is at hand', () => {
    const product = new Product();

    applyEntityLinks(
      product,
      descriptors,
      { category: 'brand-2' },
      { category: new Brand('brand-2', 'Globex') },
    );

    expect(product.category.isLoaded).toBe(false);
    expect(product.category.id).toBe('brand-2');
    expect(serializeEntity(Product, product)['category']).toBe('brand-2');
  });

  it('writes the draft id when nothing was picked', () => {
    const product = new Product();

    applyEntityLinks(product, descriptors, {
      brand: 'brand-3',
      category: 'brand-4',
    });

    expect(product.brand.isLoaded).toBe(false);
    expect(product.brand.id).toBe('brand-3');
    expect(product.category.id).toBe('brand-4');
  });

  // Clearing a relation must survive a re-apply: a link that still holds the
  // previous value would silently re-embed the target the user just removed.
  it('clears the link when the draft is empty', () => {
    const product = new Product();
    applyEntityLinks(
      product,
      descriptors,
      { brand: 'brand-1' },
      { brand: new Brand('brand-1', 'Acme') },
    );

    applyEntityLinks(product, descriptors, { brand: '' });

    expect(product.brand.value).toBeUndefined();
    expect(product.brand.id).toBeUndefined();
    expect(serializeEntity(Product, product)['brand']).toBeUndefined();
  });

  it('falls back to the draft id when the picked instance has none', () => {
    const product = new Product();

    applyEntityLinks(
      product,
      descriptors,
      { category: 'brand-5' },
      { category: new Brand(undefined, 'Unsaved') },
    );

    expect(product.category.id).toBe('brand-5');
  });

  it('leaves a picked instance with no id and no draft id empty', () => {
    const product = new Product();

    applyEntityLinks(
      product,
      descriptors,
      {},
      { category: new Brand(undefined, 'Unsaved') },
    );

    expect(product.category.id).toBeUndefined();
  });

  it('ignores collections, missing draft entries and uninitialized members', () => {
    const product = new Product();

    expect(() =>
      applyEntityLinks(product, descriptors, {}, { tags: new Brand('t-1') }),
    ).not.toThrow();
    expect(product.tags.ids).toEqual([]);
    expect(product.broken).toBeUndefined();
  });
});

describe('seedEntityLinkSelection', () => {
  it('collects the targets a record already carries', () => {
    const product = new Product();
    const brand = new Brand('brand-1', 'Acme');
    product.brand.setValue(brand);
    product.category.setId('brand-2');

    expect(seedEntityLinkSelection(descriptors, product)).toEqual({
      brand,
    });
  });

  it('is empty without a record', () => {
    expect(seedEntityLinkSelection(descriptors, undefined)).toEqual({});
  });
});
