import { Effect } from 'effect';

import {
  accessor,
  EntifixBuildError,
  Entity,
  entity,
  EntityId,
  EntityLink,
  EntityPage,
  makeEntityCollectionEnvelope,
  makeEntityEnvelope,
  makeEntityPageEnvelope,
  readEntityCollectionEnvelope,
  readEntityEnvelope,
  readEntityPageEnvelope,
} from '../index.js';

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

function makeBrand(id: string, name: string): Brand {
  const brand = new Brand();
  brand.id = id;
  brand.name = name;
  return brand;
}

describe('makeEntityEnvelope', () => {
  it('wraps a serialized entity in meta/data, keyed by the entity key', () => {
    expect(makeEntityEnvelope(Brand, makeBrand('brand-1', 'Acme'))).toEqual({
      meta: { type: 'entity', entity: 'brand' },
      data: { id: 'brand-1', name: 'Acme' },
    });
  });

  it('carries HATEOAS links on meta when supplied, and omits the key otherwise', () => {
    const links = [{ rel: 'self', href: '/api/brand/brand-1', method: 'GET' as const }];
    const withLinks = makeEntityEnvelope(Brand, makeBrand('brand-1', 'Acme'), links);
    expect(withLinks.meta.links).toEqual(links);
    expect(makeEntityEnvelope(Brand, makeBrand('brand-1', 'Acme')).meta).not.toHaveProperty(
      'links',
    );
  });
});

describe('makeEntityPageEnvelope', () => {
  it('wraps items/total/request under an entityPage envelope', () => {
    const page: EntityPage<Brand> = {
      items: [makeBrand('brand-1', 'Acme')],
      total: 1,
      request: { page: 1, pageSize: 10 },
    };
    expect(makeEntityPageEnvelope(Brand, page)).toEqual({
      meta: { type: 'entityPage', entity: 'brand' },
      data: {
        items: [{ id: 'brand-1', name: 'Acme' }],
        total: 1,
        request: { page: 1, pageSize: 10 },
      },
    });
  });
});

describe('readEntityEnvelope', () => {
  it('round-trips an entity through make/read', () => {
    const envelope = makeEntityEnvelope(Brand, makeBrand('brand-1', 'Acme'));
    const result = Effect.runSync(readEntityEnvelope(Brand, envelope));

    expect(result).toBeInstanceOf(Brand);
    expect(result.id).toBe('brand-1');
    expect(result.name).toBe('Acme');
  });

  it('round-trips an embedded link, leaving it loaded', () => {
    const product = new Product();
    product.id = 'product-1';
    product.name = 'Widget';
    product.brand.setValue(makeBrand('brand-1', 'Acme'));

    const result = Effect.runSync(
      readEntityEnvelope(Product, makeEntityEnvelope(Product, product)),
    );

    expect(result.brand.isLoaded).toBe(true);
    expect(result.brand.value?.name).toBe('Acme');
  });

  it('round-trips a foreign-key link, leaving it unloaded', () => {
    const product = new Product();
    product.id = 'product-1';
    product.brand.setId('brand-9');

    const result = Effect.runSync(
      readEntityEnvelope(Product, makeEntityEnvelope(Product, product)),
    );

    expect(result.brand.isLoaded).toBe(false);
    expect(result.brand.id).toBe('brand-9');
  });

  it('fails with EntifixBuildError when the payload is not an envelope', () => {
    const result = Effect.runSync(
      readEntityEnvelope(Brand, { id: 'brand-1' }).pipe(Effect.flip),
    );
    expect(result).toBeInstanceOf(EntifixBuildError);
    expect(result.message).toContain('no meta.type');
  });

  it('fails with EntifixBuildError when meta.type does not match', () => {
    const envelope = makeEntityCollectionEnvelope(Brand, [makeBrand('brand-1', 'Acme')]);
    const result = Effect.runSync(readEntityEnvelope(Brand, envelope).pipe(Effect.flip));

    expect(result).toBeInstanceOf(EntifixBuildError);
    expect(result.message).toContain('Expected an EntifixEnvelope of type "entity"');
    expect(result.message).toContain('entityCollection');
  });

  it('fails with EntifixBuildError when the envelope carries no data', () => {
    const result = Effect.runSync(
      readEntityEnvelope(Brand, {
        meta: { type: 'entity', entity: 'brand' },
        data: null,
      }).pipe(Effect.flip),
    );
    expect(result).toBeInstanceOf(EntifixBuildError);
    expect(result.message).toContain('carried no data');
  });
});

describe('readEntityCollectionEnvelope', () => {
  it('round-trips a collection through make/read', () => {
    const envelope = makeEntityCollectionEnvelope(Brand, [
      makeBrand('brand-1', 'Acme'),
      makeBrand('brand-2', 'Globex'),
    ]);
    const result = Effect.runSync(readEntityCollectionEnvelope(Brand, envelope));

    expect(result).toHaveLength(2);
    expect(result.map(brand => brand.name)).toEqual(['Acme', 'Globex']);
  });
});

describe('readEntityPageEnvelope', () => {
  it('round-trips a page through make/read', () => {
    const page: EntityPage<Brand> = {
      items: [makeBrand('brand-1', 'Acme')],
      total: 42,
      request: { page: 2, pageSize: 10 },
    };
    const result = Effect.runSync(
      readEntityPageEnvelope(Brand, makeEntityPageEnvelope(Brand, page)),
    );

    expect(result.total).toBe(42);
    expect(result.request).toEqual({ page: 2, pageSize: 10 });
    expect(result.items[0]).toBeInstanceOf(Brand);
    expect(result.items[0].name).toBe('Acme');
  });

  it('fails with EntifixBuildError when handed an entity envelope', () => {
    const envelope = makeEntityEnvelope(Brand, makeBrand('brand-1', 'Acme'));
    const result = Effect.runSync(readEntityPageEnvelope(Brand, envelope).pipe(Effect.flip));

    expect(result).toBeInstanceOf(EntifixBuildError);
    expect(result.message).toContain('Expected an EntifixEnvelope of type "entityPage"');
  });
});
