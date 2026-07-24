import {
  accessor,
  describeEntityColumns,
  type Entity,
  entity,
  EntityCollectionLink,
  type EntityId,
  EntityLink,
} from '@r10c/entifix-ts-core';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  seedEntityDraft,
  seedFieldValue,
  validateEntityDraft,
} from './use-entity-form.helpers';
import { useEntityForm } from './use-entity-form.js';

@entity({ key: 'gadget-brand' })
class GadgetBrand implements Entity {
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

@entity({ key: 'gadget' })
class Gadget implements Entity {
  #id?: EntityId;
  #code?: string;
  #stock = 0;
  #tier?: string;
  #releasedAt?: Date;
  #sku?: string;
  #brand = new EntityLink(GadgetBrand);
  #tags = new EntityCollectionLink(GadgetBrand);

  @accessor({ type: 'id', hidden: true })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', label: 'Code', required: true })
  get code(): string | undefined {
    return this.#code;
  }
  set code(value: string | undefined) {
    this.#code = value;
  }

  @accessor({ type: 'number', label: 'Stock' })
  get stock(): number {
    return this.#stock;
  }
  set stock(value: number) {
    this.#stock = value;
  }

  @accessor({ type: 'enum', label: 'Tier', enumValues: ['bronze', 'gold'] })
  get tier(): string | undefined {
    return this.#tier;
  }
  set tier(value: string | undefined) {
    this.#tier = value;
  }

  @accessor({ type: 'date', label: 'Released' })
  get releasedAt(): Date | undefined {
    return this.#releasedAt;
  }
  set releasedAt(value: Date | undefined) {
    this.#releasedAt = value;
  }

  @accessor({ type: 'string', label: 'SKU', readonly: true })
  get sku(): string | undefined {
    return this.#sku;
  }

  @accessor({ type: 'link', label: 'Brand' })
  get brand(): EntityLink<GadgetBrand> {
    return this.#brand;
  }

  @accessor({ type: 'linkCollection', label: 'Tags' })
  get tags(): EntityCollectionLink<GadgetBrand> {
    return this.#tags;
  }
}

const descriptors = describeEntityColumns(Gadget);

function makeGadget(): Gadget {
  const gadget = new Gadget();
  gadget.id = 'g-1';
  gadget.code = 'G-1';
  gadget.stock = 42;
  gadget.tier = 'gold';
  gadget.releasedAt = new Date('2026-07-20T00:00:00.000Z');
  gadget.brand.setId('brand-1');
  gadget.tags.setIds(['t-1', 't-2']);
  return gadget;
}

describe('seedFieldValue', () => {
  const byName = (name: string) =>
    descriptors.find(descriptor => descriptor.name === name)!;

  it('returns empty for a missing entity or absent value', () => {
    expect(seedFieldValue(byName('code'), undefined)).toBe('');
    expect(seedFieldValue(byName('code'), new Gadget())).toBe('');
  });

  it('stringifies a scalar', () => {
    expect(seedFieldValue(byName('stock'), makeGadget())).toBe('42');
  });

  it('seeds a link from its foreign key', () => {
    expect(seedFieldValue(byName('brand'), makeGadget())).toBe('brand-1');
  });

  it('seeds an empty link as empty', () => {
    expect(seedFieldValue(byName('brand'), new Gadget())).toBe('');
  });

  it('seeds a collection link from its ids', () => {
    expect(seedFieldValue(byName('tags'), makeGadget())).toBe('t-1,t-2');
  });

  it('seeds a date as a yyyy-mm-dd value', () => {
    expect(seedFieldValue(byName('releasedAt'), makeGadget())).toBe(
      '2026-07-20',
    );
  });
});

describe('seedEntityDraft', () => {
  it('builds a value for every field', () => {
    expect(seedEntityDraft(descriptors, makeGadget())).toMatchObject({
      code: 'G-1',
      stock: '42',
      tier: 'gold',
      brand: 'brand-1',
    });
  });
});

describe('validateEntityDraft', () => {
  const base = seedEntityDraft(descriptors, makeGadget());

  it('passes a well-formed draft', () => {
    expect(validateEntityDraft(descriptors, base)).toEqual({});
  });

  it('flags a missing required field', () => {
    expect(validateEntityDraft(descriptors, { ...base, code: '  ' })).toEqual({
      code: 'Code is required',
    });
  });

  it('flags a malformed number', () => {
    expect(
      validateEntityDraft(descriptors, { ...base, stock: 'abc' }),
    ).toEqual({ stock: 'Stock must be a number' });
  });

  it('flags a malformed date', () => {
    expect(
      validateEntityDraft(descriptors, { ...base, releasedAt: 'not-a-date' }),
    ).toEqual({ releasedAt: 'Released must be a date' });
  });

  it('flags a value outside the enum', () => {
    expect(
      validateEntityDraft(descriptors, { ...base, tier: 'platinum' }),
    ).toEqual({ tier: 'Tier is not a valid option' });
  });

  it('ignores empty optional fields', () => {
    expect(
      validateEntityDraft(descriptors, { ...base, stock: '', tier: '' }),
    ).toEqual({});
  });

  it('never validates read-only members or relations', () => {
    // A bad SKU (read-only) and a junk brand id are both left alone.
    expect(
      validateEntityDraft(descriptors, {
        ...base,
        sku: 'anything',
        brand: 'junk',
      }),
    ).toEqual({});
  });

  it('treats an absent key as empty', () => {
    // A draft missing `code` entirely still reports it as required.
    expect(validateEntityDraft(descriptors, {})).toEqual({
      code: 'Code is required',
    });
  });

  it('merges caller rules, which win on conflict', () => {
    const errors = validateEntityDraft(descriptors, base, () => ({
      code: 'Code already taken',
    }));

    expect(errors).toEqual({ code: 'Code already taken' });
  });
});

describe('useEntityForm', () => {
  it('seeds its values from the entity', () => {
    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        onSubmit: vi.fn(),
      }),
    );

    expect(result.current.values.code).toBe('G-1');
    expect(result.current.isDirty).toBe(false);
  });

  it('seeds from initialValues over the entity when given', () => {
    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        initialValues: { code: 'DRAFT' },
        onSubmit: vi.fn(),
      }),
    );

    expect(result.current.values.code).toBe('DRAFT');
  });

  it('updates a field and marks the form dirty', () => {
    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        onSubmit: vi.fn(),
      }),
    );

    act(() => result.current.setField('code', 'G-2'));

    expect(result.current.values.code).toBe('G-2');
    expect(result.current.isDirty).toBe(true);
  });

  it('hides errors until the first submit attempt', () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useEntityForm({ entityConstructor: Gadget, onSubmit }),
    );

    // A create form has an empty required `code`, but nothing shows yet.
    expect(result.current.errors).toEqual({});

    act(() => result.current.submit());

    expect(result.current.errors).toEqual({ code: 'Code is required' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the draft once it is valid', async () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        onSubmit,
      }),
    );

    await act(async () => {
      result.current.submit();
    });

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'G-1', stock: '42' }),
    );
  });
});
