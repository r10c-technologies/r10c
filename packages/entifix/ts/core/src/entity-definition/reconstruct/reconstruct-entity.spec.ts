import { describe, expect, it } from 'vitest';

import {
  accessor,
  Entity,
  entity,
  EntityCollectionLink,
  EntityId,
  EntityLink,
  reconstructEntity,
} from '../../index.js';

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

/** One member per {@link MetaAccessorType}, plus the two exclusions. */
@entity({ key: 'sample' })
class Sample implements Entity {
  #id?: EntityId;
  #name?: string;
  #quantity?: number;
  #active = false;
  #releasedAt?: Date;
  #tier?: string;
  #stamp?: string;
  #brand = new EntityLink(Brand);
  #tags = new EntityCollectionLink(Tag);
  /** A relation that declared no `type` — inferred from the sample instance. */
  #owner = new EntityLink(Brand);

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

  @accessor({ type: 'number' })
  get quantity(): number | undefined {
    return this.#quantity;
  }
  set quantity(value: number | undefined) {
    this.#quantity = value;
  }

  @accessor({ type: 'boolean' })
  get active(): boolean {
    return this.#active;
  }
  set active(value: boolean) {
    this.#active = value;
  }

  @accessor({ type: 'date' })
  get releasedAt(): Date | undefined {
    return this.#releasedAt;
  }
  set releasedAt(value: Date | undefined) {
    this.#releasedAt = value;
  }

  @accessor({ type: 'enum', enumValues: ['gold', 'silver'] })
  get tier(): string | undefined {
    return this.#tier;
  }
  set tier(value: string | undefined) {
    this.#tier = value;
  }

  @accessor({ type: 'string', readonly: true })
  get stamp(): string | undefined {
    return this.#stamp;
  }
  set stamp(value: string | undefined) {
    this.#stamp = value;
  }

  @accessor({ type: 'link', linkSerialization: 'embedded' })
  get brand(): EntityLink<Brand> {
    return this.#brand;
  }

  @accessor({ type: 'linkCollection' })
  get tags(): EntityCollectionLink<Tag> {
    return this.#tags;
  }

  @accessor()
  get owner(): EntityLink<Brand> {
    return this.#owner;
  }
}

/** A member the form hides but that must still be carried back. */
@entity({ key: 'hidden-carrier' })
class HiddenCarrier implements Entity {
  #id?: EntityId;
  #code?: string;
  #secret?: string;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string' })
  get code(): string | undefined {
    return this.#code;
  }
  set code(value: string | undefined) {
    this.#code = value;
  }

  @accessor({ type: 'string', hidden: true })
  get secret(): string | undefined {
    return this.#secret;
  }
  set secret(value: string | undefined) {
    this.#secret = value;
  }
}

/** Required constructor arguments, filled by the setters instead. */
@entity({ key: 'positional' })
class Positional implements Entity {
  #id?: EntityId;
  #code: string;
  #name: string;

  constructor(code = '', name = '') {
    this.#code = code;
    this.#name = name;
  }

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', required: true })
  get code(): string {
    return this.#code;
  }
  set code(value: string) {
    this.#code = value;
  }

  @accessor({ type: 'string', required: true })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }
}

describe('reconstructEntity', () => {
  it('coerces each type from its draft string', () => {
    const result = reconstructEntity(Sample, {
      id: 'sample-1',
      name: 'Widget',
      quantity: '42',
      active: 'true',
      releasedAt: '2026-01-15',
      tier: 'gold',
    });

    expect(result.id).toBe('sample-1');
    expect(result.name).toBe('Widget');
    expect(result.quantity).toBe(42);
    expect(result.active).toBe(true);
    expect(result.releasedAt).toEqual(new Date('2026-01-15'));
    expect(result.tier).toBe('gold');
  });

  it('reads an empty string as undefined', () => {
    const result = reconstructEntity(Sample, {
      name: '',
      quantity: '',
      releasedAt: '',
      tier: '',
    });

    expect(result.name).toBeUndefined();
    expect(result.quantity).toBeUndefined();
    expect(result.releasedAt).toBeUndefined();
    expect(result.tier).toBeUndefined();
  });

  it('treats a missing key exactly like an empty one', () => {
    const result = reconstructEntity(Sample, {});

    expect(result.name).toBeUndefined();
    expect(result.quantity).toBeUndefined();
  });

  it('reads an empty numeric field as absent, not as zero', () => {
    // `Number('')` is `0`, so checking the type before the empty string would
    // turn every blank numeric field into a real value.
    const result = reconstructEntity(Sample, { quantity: '' });

    expect(result.quantity).toBeUndefined();
    expect(result.quantity).not.toBe(0);
  });

  it('reads an empty boolean field as false, not as absent', () => {
    // A checkbox renders `''` as unchecked, so the draft of a box the user left
    // clear is `''` — and it means `false`, not "no answer".
    const result = reconstructEntity(Sample, { active: '' });

    expect(result.active).toBe(false);
  });

  it('reads any other boolean draft as false', () => {
    expect(reconstructEntity(Sample, { active: 'false' }).active).toBe(false);
    expect(reconstructEntity(Sample, { active: 'yes' }).active).toBe(false);
  });

  it('passes a malformed number or date through rather than dropping it', () => {
    const result = reconstructEntity(Sample, {
      quantity: 'abc',
      releasedAt: 'not-a-date',
    });

    expect(result.quantity).toBeNaN();
    expect(result.releasedAt?.getTime()).toBeNaN();
  });

  it('never writes a read-only member', () => {
    const result = reconstructEntity(Sample, { stamp: 'tampered' });

    expect(result.stamp).toBeUndefined();
  });

  it('never writes a hidden member, and leaves the visible ones alone', () => {
    // `describeEntityColumns` filters hidden members, so a draft cannot reach
    // one — the form has no input for it either.
    const result = reconstructEntity(HiddenCarrier, {
      code: 'brand-001',
      secret: 'tampered',
    });

    expect(result.code).toBe('brand-001');
    expect(result.secret).toBeUndefined();
  });

  it('fills required constructor arguments through their setters', () => {
    const result = reconstructEntity(Positional, {
      code: 'P-1',
      name: 'Widget',
    });

    expect(result.code).toBe('P-1');
    expect(result.name).toBe('Widget');
  });

  it('delegates relations to applyEntityLinks', () => {
    const brand = new Brand('brand-1', 'Acme');
    const result = reconstructEntity(
      Sample,
      { brand: 'brand-1', owner: 'brand-2' },
      { selection: { brand } },
    );

    // `embedded`, and the instance was picked: inlined.
    expect(result.brand.value).toBe(brand);
    // Inferred as a `link` from the constructed sample, so it took the id.
    expect(result.owner.id).toBe('brand-2');
  });

  it('leaves a to-many relation untouched', () => {
    const result = reconstructEntity(Sample, { tags: 'tag-1,tag-2' });

    expect(result.tags).toBeInstanceOf(EntityCollectionLink);
    expect(result.tags.ids).toEqual([]);
  });

  it('takes the id from the record being edited', () => {
    const existing = new Positional('P-0', 'Old');
    existing.id = 'record-1';

    const result = reconstructEntity(
      Positional,
      { id: 'tampered', code: 'P-1', name: 'Widget' },
      { existing },
    );

    expect(result.id).toBe('record-1');
    expect(result.code).toBe('P-1');
  });

  it('takes the id from the draft when there is no record', () => {
    const result = reconstructEntity(Positional, {
      id: '',
      code: 'P-1',
      name: 'Widget',
    });

    expect(result.id).toBeUndefined();
  });

  it('clears the id when the record being edited has none', () => {
    const result = reconstructEntity(
      Positional,
      { id: 'tampered', code: 'P-1', name: 'Widget' },
      { existing: new Positional('P-0', 'Old') },
    );

    expect(result.id).toBeUndefined();
  });
});

describe('collections', () => {
  @entity({ key: 'hamper' })
  class Hamper implements Entity {
    #id?: EntityId;
    #tags: readonly string[] = ['seeded'];
    #lines: readonly object[] = [{ sku: 'a' }];

    @accessor({ type: 'id' })
    get id(): EntityId {
      return this.#id;
    }
    set id(value: EntityId) {
      this.#id = value;
    }

    @accessor({ type: 'scalarCollection' })
    get tags(): readonly string[] {
      return this.#tags;
    }
    set tags(value: readonly string[]) {
      this.#tags = value;
    }

    @accessor({ type: 'composition', childType: () => Brand })
    get lines(): readonly object[] {
      return this.#lines;
    }
    set lines(value: readonly object[]) {
      this.#lines = value;
    }
  }

  it('splits a scalar collection back out of its comma list', () => {
    const rebuilt = reconstructEntity(Hamper, { tags: 'red,green,blue' });

    expect(rebuilt.tags).toEqual(['red', 'green', 'blue']);
  });

  /**
   * Empty means "no values", not "not set". Falling into the blanket
   * empty-string rule would write `undefined` over a member the entity declares
   * as an array, so a `required` check would then be judging the wrong thing —
   * the same class of ordering bug as `boolean` and `number`.
   */
  it('reads a cleared scalar collection as empty, never undefined', () => {
    const rebuilt = reconstructEntity(Hamper, { tags: '' });

    expect(rebuilt.tags).toEqual([]);
  });

  /**
   * A composition has no editor yet (#122), so a draft never holds its rows.
   * Writing the member anyway would blank a record's own lines on every save of
   * an unrelated field — which is why it is excluded from the scalar walk
   * rather than coerced to something.
   */
  it('leaves an owned collection untouched', () => {
    const rebuilt = reconstructEntity(Hamper, { lines: '' });

    expect(rebuilt.lines).toEqual([{ sku: 'a' }]);
  });
});
