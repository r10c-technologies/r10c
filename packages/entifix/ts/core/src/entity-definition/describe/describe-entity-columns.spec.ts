import {
  accessor,
  describeEntityColumns,
  Entity,
  entity,
  EntityCollectionLink,
  EntityId,
  EntityLink,
} from '../../index.js';

@entity({ key: 'brand' })
class Brand implements Entity {
  #id?: EntityId;
  #name?: string;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }
}

@entity({ key: 'article' })
class Article implements Entity {
  #id?: EntityId;
  #productCode?: string;
  #stock = 0;
  #releasedAt?: Date;
  #secret?: string;
  #internalNote?: string;
  #brand = new EntityLink(Brand);

  @accessor({ type: 'id', order: 0 })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  // Undeclared type + no label: both are derived.
  @accessor()
  get productCode(): string | undefined {
    return this.#productCode;
  }
  set productCode(value: string | undefined) {
    this.#productCode = value;
  }

  @accessor({ type: 'number', label: 'Units in stock', order: 10 })
  get stock(): number {
    return this.#stock;
  }
  set stock(value: number) {
    this.#stock = value;
  }

  @accessor({ type: 'date' })
  get releasedAt(): Date | undefined {
    return this.#releasedAt;
  }
  set releasedAt(value: Date | undefined) {
    this.#releasedAt = value;
  }

  @accessor({ hidden: true })
  get secret(): string | undefined {
    return this.#secret;
  }
  set secret(value: string | undefined) {
    this.#secret = value;
  }

  // Read-only members are still displayable — unlike serialization, which skips
  // them.
  @accessor({ readonly: true, type: 'string' })
  get internalNote(): string | undefined {
    return this.#internalNote;
  }

  @accessor({ type: 'link', linkLabelProperty: 'name' })
  get brand(): EntityLink<Brand> {
    return this.#brand;
  }
}

describe('describeEntityColumns', () => {
  const columns = describeEntityColumns(Article);
  const byName = (name: string) => columns.find(column => column.name === name);

  it('skips hidden accessors and keeps read-only ones', () => {
    expect(byName('secret')).toBeUndefined();
    expect(byName('internalNote')).toBeDefined();
  });

  it('emits one descriptor per getter, deduped against its setter', () => {
    expect(columns.filter(column => column.name === 'stock')).toHaveLength(1);
  });

  it('humanizes the label when none is declared', () => {
    expect(byName('productCode')?.label).toBe('Product Code');
  });

  it('prefers the declared label', () => {
    expect(byName('stock')?.label).toBe('Units in stock');
  });

  it('sorts by declared order, falling back to declaration order', () => {
    expect(columns.map(column => column.name)).toEqual([
      'id',
      'productCode',
      'releasedAt',
      'internalNote',
      'brand',
      'stock',
    ]);
  });

  it('defaults sortable/filterable on for scalars and off for id and links', () => {
    expect(byName('stock')).toMatchObject({ sortable: true, filterable: true });
    expect(byName('id')).toMatchObject({ sortable: false, filterable: false });
    expect(byName('brand')).toMatchObject({
      sortable: false,
      filterable: false,
    });
  });

  it('falls back to string when a type is neither declared nor inferable', () => {
    expect(byName('productCode')?.type).toBe('string');
  });
});

describe('describeEntityColumns type inference', () => {
  @entity({ key: 'bare' })
  class Bare implements Entity {
    #id?: EntityId;
    #count = 0;
    #active = false;
    #createdAt = new Date();
    #brand = new EntityLink(Brand);
    #brands = new EntityCollectionLink(Brand);

    @accessor()
    get id(): EntityId {
      return this.#id;
    }
    set id(value: EntityId) {
      this.#id = value;
    }

    @accessor()
    get count(): number {
      return this.#count;
    }

    @accessor()
    get active(): boolean {
      return this.#active;
    }

    @accessor()
    get createdAt(): Date {
      return this.#createdAt;
    }

    @accessor()
    get brand(): EntityLink<Brand> {
      return this.#brand;
    }

    @accessor()
    get brands(): EntityCollectionLink<Brand> {
      return this.#brands;
    }
  }

  it('reads the type off a sample value', () => {
    const columns = describeEntityColumns(Bare, new Bare());
    const types = Object.fromEntries(
      columns.map(column => [column.name, column.type]),
    );

    expect(types).toEqual({
      id: 'id',
      count: 'number',
      active: 'boolean',
      createdAt: 'date',
      brand: 'link',
      brands: 'linkCollection',
    });
  });
});

describe('describeEntityColumns deduplication', () => {
  // Subclass metadata inherits the parent's accessor list, so re-decorating an
  // overridden member registers it twice. The first entry — the subclass's own,
  // appended last but reached first via the inherited array — must not produce a
  // duplicate column.
  @entity({ key: 'base-widget' })
  class BaseWidget implements Entity {
    #id?: EntityId;
    #label?: string;

    @accessor({ type: 'id' })
    get id(): EntityId {
      return this.#id;
    }
    set id(value: EntityId) {
      this.#id = value;
    }

    @accessor({ label: 'Base label' })
    get label(): string | undefined {
      return this.#label;
    }
    set label(value: string | undefined) {
      this.#label = value;
    }
  }

  @entity({ key: 'special-widget' })
  class SpecialWidget extends BaseWidget {
    @accessor({ label: 'Special label' })
    override get label(): string | undefined {
      return super.label;
    }
    override set label(value: string | undefined) {
      super.label = value;
    }
  }

  it('emits one column per name even when a member is redeclared', () => {
    const columns = describeEntityColumns(SpecialWidget);

    expect(columns.filter(column => column.name === 'label')).toHaveLength(1);
  });
});
