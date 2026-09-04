import {
  accessor,
  describeEntityColumns,
  type Entity,
  entity,
  EntityCollectionLink,
  type EntityDraft,
  type EntityId,
  EntityLink,
  type StandardSchemaV1,
  type StandardSchemaV1Issue,
} from '@r10c/entifix-ts-core';
import { createI18n } from '@r10c/entifix-ts-i18n';
import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

import {
  composeEntityFormErrors,
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
  #labels: readonly string[] = [];
  #lines: readonly object[] = [];

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

  @accessor({ type: 'scalarCollection', label: 'Labels' })
  get labels(): readonly string[] {
    return this.#labels;
  }
  set labels(value: readonly string[]) {
    this.#labels = value;
  }

  @accessor({
    type: 'composition',
    label: 'Lines',
    childType: () => GadgetBrand,
  })
  get lines(): readonly object[] {
    return this.#lines;
  }
  set lines(value: readonly object[]) {
    this.#lines = value;
  }
}

@entity({ key: 'widget' })
class Widget implements Entity {
  #id?: EntityId;
  #brand = new EntityLink(GadgetBrand);
  #tags = new EntityCollectionLink(GadgetBrand);

  @accessor({ type: 'id', hidden: true })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  /** A relation the domain insists on — the case `required` exists for. */
  @accessor({ type: 'link', label: 'Brand', required: true })
  get brand(): EntityLink<GadgetBrand> {
    return this.#brand;
  }

  /**
   * The same rule in its to-many shape. It went unenforced for as long as a
   * collection was treated as a member no form writes back, which is a claim
   * about the controls rather than about what the domain insists on.
   */
  @accessor({ type: 'linkCollection', label: 'Tags', required: true })
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
  gadget.labels = ['a', 'b'];
  gadget.lines = [{ sku: 'x' }];
  return gadget;
}

/**
 * A draft store double. `save`/`clear` are stable across renders because the
 * port requires it — the hook autosaves from an effect keyed on `save`, so a
 * fresh identity per render would make every render a write and hide exactly
 * the behaviour these tests assert.
 */
function draftStore(draft?: EntityDraft) {
  return { draft, save: vi.fn(), clear: vi.fn() };
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

  /**
   * The join is declared rather than left to `String(raw)`, which produced the
   * same characters by way of `Array.prototype.toString` while
   * `reconstructEntity` handed them back as one string. Both halves were wrong
   * in the same direction, so the round-trip spec could not see it.
   */
  it('seeds a scalar collection as a comma list', () => {
    expect(seedFieldValue(byName('labels'), makeGadget())).toBe('a,b');
  });

  /**
   * Owned rows are the one member that does not seed as a string — they have no
   * lossless string form at all, so they seed as row drafts the detail grid
   * edits directly.
   */
  it('seeds an owned collection as keyed row drafts', () => {
    expect(seedFieldValue(byName('lines'), makeGadget())).toEqual([
      { $key: 'row-0', id: '', name: '' },
    ]);
  });

  it('seeds a row key that survives re-seeding the same record', () => {
    // A caller that builds its record inline re-seeds on every render; a fresh
    // random key there makes the draft differ on every pass and the form engine
    // never settles.
    expect(seedFieldValue(byName('lines'), makeGadget())).toEqual(
      seedFieldValue(byName('lines'), makeGadget()),
    );
  });

  it('seeds no rows for a record that holds none', () => {
    expect(seedFieldValue(byName('lines'), new Gadget())).toEqual([]);
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

/**
 * `validateEntityDraft` is pure and takes its wording as an argument, so these
 * cases assert the *rules* rather than any locale's phrasing.
 */
const MESSAGES = {
  required: (field: string) => `${field} is required`,
  number: (field: string) => `${field} must be a number`,
  date: (field: string) => `${field} must be a date`,
  option: (field: string) => `${field} is not a valid option`,
};

describe('validateEntityDraft', () => {
  const base = seedEntityDraft(descriptors, makeGadget());

  it('passes a well-formed draft', () => {
    expect(validateEntityDraft(descriptors, base, MESSAGES)).toEqual({});
  });

  it('flags a missing required field', () => {
    expect(
      validateEntityDraft(descriptors, { ...base, code: '  ' }, MESSAGES),
    ).toEqual({
      code: 'Code is required',
    });
  });

  it('flags a malformed number', () => {
    expect(
      validateEntityDraft(descriptors, { ...base, stock: 'abc' }, MESSAGES),
    ).toEqual({ stock: 'Stock must be a number' });
  });

  it('flags a malformed date', () => {
    expect(
      validateEntityDraft(
        descriptors,
        { ...base, releasedAt: 'not-a-date' },
        MESSAGES,
      ),
    ).toEqual({ releasedAt: 'Released must be a date' });
  });

  it('flags a value outside the enum', () => {
    expect(
      validateEntityDraft(descriptors, { ...base, tier: 'platinum' }, MESSAGES),
    ).toEqual({ tier: 'Tier is not a valid option' });
  });

  it('ignores empty optional fields', () => {
    expect(
      validateEntityDraft(
        descriptors,
        { ...base, stock: '', tier: '' },
        MESSAGES,
      ),
    ).toEqual({});
  });

  // The *format* of a foreign key is the service's business, not the form's —
  // but whether one is there at all is exactly what `required` has to mean on a
  // relation, and it used to be skipped along with the format check.
  it('never judges the format of a read-only member or a relation', () => {
    // A bad SKU (read-only) and a junk brand id are both left alone.
    expect(
      validateEntityDraft(
        descriptors,
        {
          ...base,
          sku: 'anything',
          brand: 'junk',
        },
        MESSAGES,
      ),
    ).toEqual({});
  });

  it('reports a required relation left empty, to-one and to-many alike', () => {
    // The collection is the half that used to pass silently: a rule the entity
    // declared and the form never applied, because a member with no editor yet
    // was treated as a member nothing may ever write.
    expect(
      validateEntityDraft(
        describeEntityColumns(Widget),
        { brand: '', tags: '' },
        MESSAGES,
      ),
    ).toEqual({ brand: 'Brand is required', tags: 'Tags is required' });
  });

  it('accepts a required relation once a key is held', () => {
    expect(
      validateEntityDraft(
        describeEntityColumns(Widget),
        { brand: 'brand-1', tags: 't-1,t-2' },
        MESSAGES,
      ),
    ).toEqual({});
  });

  it('judges a collection on presence alone, never on the ids in it', () => {
    // Same bargain as a to-one relation: whether the targets exist is the
    // service's answer to give, so anything non-empty satisfies the form.
    expect(
      validateEntityDraft(
        describeEntityColumns(Widget),
        { brand: 'brand-1', tags: 'junk,,,' },
        MESSAGES,
      ),
    ).toEqual({});
  });

  it('treats an absent key as empty', () => {
    // A draft missing `code` entirely still reports it as required.
    expect(validateEntityDraft(descriptors, {}, MESSAGES)).toEqual({
      code: 'Code is required',
    });
  });
});

/**
 * A Standard Schema is an interface, not a library, so these build one by hand:
 * it keeps the spec free of a schema dependency and pins the exact contract the
 * hook consumes — `~standard.validate` returning issues with a `path`.
 */
function schemaOf(
  issues: readonly StandardSchemaV1Issue[],
): StandardSchemaV1<EntityDraft> {
  return {
    '~standard': {
      version: 1,
      vendor: 'spec',
      validate: value =>
        issues.length === 0 ? { value: value as EntityDraft } : { issues },
    },
  };
}

/** Stands in for the hook's i18n pass; here a key just gains its field. */
const translateIssue = (message: string, field: string | undefined) =>
  field === undefined ? message : `${field}: ${message}`;

describe('composeEntityFormErrors', () => {
  const base = seedEntityDraft(descriptors, makeGadget());
  const compose = (
    extra: Partial<Parameters<typeof composeEntityFormErrors>[0]> = {},
  ) =>
    composeEntityFormErrors({
      descriptors,
      values: base,
      messages: MESSAGES,
      translateIssue,
      ...extra,
    });

  it('reports nothing for a clean draft with no extra rules', () => {
    expect(compose()).toEqual({ fields: {}, form: undefined });
  });

  it('lets caller rules win over the metadata ones', () => {
    expect(
      compose({
        values: { ...base, code: '' },
        validate: () => ({ code: 'Code already taken' }),
      }).fields,
    ).toEqual({ code: 'Code already taken' });
  });

  it('reports nothing when the schema finds no issue', () => {
    expect(compose({ schema: schemaOf([]) })).toEqual({
      fields: {},
      form: undefined,
    });
  });

  it('translates a schema issue and files it under its field', () => {
    expect(
      compose({
        schema: schemaOf([{ message: 'validation.minLength', path: ['code'] }]),
      }).fields,
    ).toEqual({ code: 'code: validation.minLength' });
  });

  // Valibot-style paths carry objects rather than bare keys.
  it('reads a field name from an object-shaped path segment', () => {
    expect(
      compose({
        schema: schemaOf([
          { message: 'validation.pattern', path: [{ key: 'code' }] },
        ]),
      }).fields,
    ).toEqual({ code: 'code: validation.pattern' });
  });

  it('keeps only the first issue reported for one field', () => {
    expect(
      compose({
        schema: schemaOf([
          { message: 'first', path: ['code'] },
          { message: 'second', path: ['code'] },
        ]),
      }).fields,
    ).toEqual({ code: 'code: first' });
  });

  // A cross-field rule has no path, so it cannot be filed under a row.
  it.each([[[]], [undefined]])(
    'surfaces a pathless issue as the form-level error (path %j)',
    path => {
      expect(
        compose({ schema: schemaOf([{ message: 'mismatch', path }]) }),
      ).toEqual({ fields: {}, form: 'mismatch' });
    },
  );

  it('refuses an async schema instead of passing it silently', () => {
    const asyncSchema: StandardSchemaV1<EntityDraft> = {
      '~standard': {
        version: 1,
        vendor: 'spec',
        validate: () => Promise.resolve({ issues: [{ message: 'nope' }] }),
      },
    };

    expect(() => compose({ schema: asyncSchema })).toThrow(/async schema/);
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

  it('layers a persisted draft over the record it was written from', () => {
    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        draft: draftStore({ code: 'DRAFT' }),
        onSubmit: vi.fn(),
      }),
    );

    expect(result.current.values.code).toBe('DRAFT');
    // Every other member keeps the record's value rather than vanishing with it.
    expect(result.current.values.stock).toBe('42');
  });

  // A draft outlives the entity that wrote it, so the two can disagree. Both
  // directions are silent and both reach the user: a member the draft never held
  // would arrive `undefined` and flip its input from controlled to uncontrolled,
  // and one the entity no longer declares would ride along as a value nothing
  // renders.
  it('drops draft keys the entity no longer declares', () => {
    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        draft: draftStore({ code: 'DRAFT', retired: 'yes' }),
        onSubmit: vi.fn(),
      }),
    );

    expect(result.current.values.code).toBe('DRAFT');
    expect('retired' in result.current.values).toBe(false);
  });

  it('keeps the seeded value for a member the draft never held', () => {
    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        draft: draftStore({ code: 'DRAFT' }),
        onSubmit: vi.fn(),
      }),
    );

    expect(result.current.values.tier).toBe('gold');
    expect(result.current.values.tier).not.toBeUndefined();
  });

  /**
   * The autosave seam. It lives in the hook rather than in each page because
   * every page that wanted it used to hand-write the same effect, and the two
   * that never did — brand and category — had no autosave at all (#131).
   */
  it('persists the draft once a field is edited', () => {
    const store = draftStore();
    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        draft: store,
        onSubmit: vi.fn(),
      }),
    );

    act(() => {
      result.current.setField('code', 'G-2');
    });

    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'G-2' }),
    );
  });

  it('writes nothing while the draft still matches its seed', () => {
    const store = draftStore();
    renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        draft: store,
        onSubmit: vi.fn(),
      }),
    );

    expect(store.save).not.toHaveBeenCalled();
  });

  /**
   * Opening a tab must not re-persist what it just restored. The seed *is* the
   * restored draft, so the form is not dirty — without that the workspace would
   * write to IndexedDB on every mount, for every tab, forever.
   */
  it('does not re-persist a restored draft on mount', () => {
    const store = draftStore({ code: 'DRAFT' });
    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        draft: store,
        onSubmit: vi.fn(),
      }),
    );

    expect(result.current.values.code).toBe('DRAFT');
    expect(store.save).not.toHaveBeenCalled();
  });

  /**
   * A draft is spent when the write *commits*, and this hook never learns
   * whether it did — it neither fetches nor saves. The host that owns the
   * mutation clears it.
   */
  it('never clears the draft itself', () => {
    const store = draftStore();
    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        draft: store,
        onSubmit: vi.fn(),
      }),
    );

    act(() => {
      result.current.setField('code', 'G-2');
    });
    act(() => {
      result.current.submit();
    });

    expect(store.clear).not.toHaveBeenCalled();
  });

  it('ignores a draft value that is not a string', () => {
    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        // What a draft written by an older shape can hold: the store guarantees
        // JSON, not this form's own type.
        draft: draftStore({ code: 42 } as unknown as EntityDraft),
        onSubmit: vi.fn(),
      }),
    );

    expect(result.current.values.code).toBe('G-1');
  });

  // The sidecar: the draft keeps ids because it must stay JSON, so the instances
  // live beside it — otherwise an embedded relation could never be reconstructed.
  it('seeds its link selection from the relations a record already carries', () => {
    const brand = new GadgetBrand();
    brand.id = 'brand-1';
    brand.name = 'Acme';
    const gadget = makeGadget();
    gadget.brand.setValue(brand);

    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: gadget,
        onSubmit: vi.fn(),
      }),
    );

    expect(result.current.links['brand']).toBe(brand);
  });

  it('holds no selection for a relation that arrived as a bare key', () => {
    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        onSubmit: vi.fn(),
      }),
    );

    expect(result.current.links['brand']).toBeUndefined();
    expect(result.current.values.brand).toBe('brand-1');
  });

  it('records both halves of a pick', () => {
    const brand = new GadgetBrand();
    brand.id = 'brand-9';
    brand.name = 'Globex';

    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        onSubmit: vi.fn(),
      }),
    );

    act(() => result.current.setLink('brand', brand));

    expect(result.current.values.brand).toBe('brand-9');
    expect(result.current.links['brand']).toBe(brand);
  });

  it('empties the draft key when a relation is cleared', () => {
    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        onSubmit: vi.fn(),
      }),
    );

    act(() => result.current.setLink('brand', undefined));

    expect(result.current.values.brand).toBe('');
    expect(result.current.links['brand']).toBeUndefined();
  });

  // The restore path: the draft kept `brand-1`, the instance behind it died with
  // the page, and the link source resolved it back.
  it('refills the sidecar from a resolved id without touching the draft', () => {
    const brand = new GadgetBrand();
    brand.id = 'brand-1';
    brand.name = 'Acme';

    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        onSubmit: vi.fn(),
      }),
    );

    act(() => result.current.hydrateLink('brand', brand));

    expect(result.current.links['brand']).toBe(brand);
    expect(result.current.values.brand).toBe('brand-1');
    // A lookup is not an edit, so the form stays pristine and the workspace has
    // nothing new to autosave.
    expect(result.current.isDirty).toBe(false);
  });

  it('leaves a pick in place when a slower lookup lands after it', () => {
    const picked = new GadgetBrand();
    picked.id = 'brand-9';
    const stale = new GadgetBrand();
    stale.id = 'brand-1';

    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        onSubmit: vi.fn(),
      }),
    );

    act(() => result.current.setLink('brand', picked));
    act(() => result.current.hydrateLink('brand', stale));

    expect(result.current.links['brand']).toBe(picked);
  });

  it('holds no key for a picked target that has none', () => {
    const unsaved = new GadgetBrand();
    unsaved.name = 'Unsaved';

    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        onSubmit: vi.fn(),
      }),
    );

    act(() => result.current.setLink('brand', unsaved));

    expect(result.current.values.brand).toBe('');
    expect(result.current.links['brand']).toBe(unsaved);
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

  // Every metadata rule renders through the catalog, not just `required` —
  // a message left as a template literal would only show up here.
  it('localizes every metadata-derived message', async () => {
    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        onSubmit: vi.fn(),
      }),
    );

    act(() => {
      result.current.setField('stock', 'abc');
      result.current.setField('releasedAt', 'not-a-date');
      result.current.setField('tier', 'platinum');
    });
    await act(async () => result.current.submit());

    expect(result.current.errors).toMatchObject({
      stock: 'Stock debe ser un número',
      releasedAt: 'Released debe ser una fecha',
      tier: 'Tier no es una opción válida',
    });
  });

  // With a provider in the tree the hook must follow it, not the shared default.
  it('follows a mounted provider instead of the fallback instance', async () => {
    const i18n = createI18n('en', [initReactI18next]);
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(I18nextProvider, { i18n }, children);

    const { result } = renderHook(
      () => useEntityForm({ entityConstructor: Gadget, onSubmit: vi.fn() }),
      { wrapper },
    );

    await act(async () => result.current.submit());

    expect(result.current.errors).toEqual({ code: 'Code is required' });
  });

  it('hides errors until the first submit attempt', async () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useEntityForm({ entityConstructor: Gadget, onSubmit }),
    );

    // A create form has an empty required `code`, but nothing shows yet.
    expect(result.current.errors).toEqual({});

    await act(async () => result.current.submit());

    expect(result.current.errors).toEqual({ code: 'Code es obligatorio' });
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

  // The whole point of the message-as-key convention: a schema written once
  // renders in the user's language, with the field's own label interpolated.
  it('resolves a schema message through the catalog', async () => {
    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        schema: schemaOf([{ message: 'validation.minLength', path: ['code'] }]),
        onSubmit: vi.fn(),
      }),
    );

    await act(async () => result.current.submit());

    expect(result.current.errors.code).toBe('Code es demasiado corto');
  });

  // A literal that is not a key still has to reach the user readably.
  it('falls back to the literal message of an unkeyed issue', async () => {
    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        schema: schemaOf([{ message: 'Sin catálogo', path: ['code'] }]),
        onSubmit: vi.fn(),
      }),
    );

    await act(async () => result.current.submit());

    expect(result.current.errors.code).toBe('Sin catálogo');
  });

  it('surfaces a pathless schema issue as the form error and blocks submit', async () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useEntityForm({
        entityConstructor: Gadget,
        entity: makeGadget(),
        // A cross-field rule names no field, so it carries its own key (or, as
        // here, a literal) rather than one of the field-parameterized ones.
        schema: schemaOf([{ message: 'Las fechas no concuerdan' }]),
        onSubmit,
      }),
    );

    expect(result.current.formError).toBeUndefined();

    await act(async () => result.current.submit());

    expect(result.current.formError).toBe('Las fechas no concuerdan');
    expect(result.current.errors).toEqual({});
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
