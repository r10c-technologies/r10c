import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import { defineEntityBuilder } from './entity-builder';

@entity({ key: 'widget' })
class Widget implements Entity {
  #id?: EntityId;
  #name?: string;
  #stock = 0;

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
  get stock(): number {
    return this.#stock;
  }
  set stock(value: number) {
    this.#stock = value;
  }
}

const aWidget = defineEntityBuilder(Widget, { name: 'Sprocket', stock: 10 });

describe('defineEntityBuilder', () => {
  it('builds a real instance, not a literal', () => {
    expect(aWidget()).toBeInstanceOf(Widget);
  });

  // Values must go through the setters: `#field` + accessor classes are
  // invisible to `MetaEntity` introspection and serialization otherwise, so a
  // literal would serialize to `{}`.
  it('assigns through the setters, so the entity serializes', () => {
    expect(serializeEntity(Widget, aWidget())).toEqual({
      name: 'Sprocket',
      stock: 10,
    });
  });

  it('applies the defaults it was given', () => {
    expect(aWidget().name).toBe('Sprocket');
  });

  it('lets an override win over a default', () => {
    expect(aWidget({ stock: 1 }).stock).toBe(1);
  });

  it('leaves unmentioned members at their class default', () => {
    expect(defineEntityBuilder(Widget)().stock).toBe(0);
  });

  it('builds a fresh instance every time', () => {
    expect(aWidget()).not.toBe(aWidget());
  });

  it('builds a list of identical rows', () => {
    const widgets = aWidget.many(3);

    expect(widgets).toHaveLength(3);
    expect(widgets.every((widget) => widget.name === 'Sprocket')).toBe(true);
  });

  // A list of distinguishable rows is the common case, so overrides can be a
  // function of the index.
  it('builds a list of distinguishable rows', () => {
    const widgets = aWidget.many(2, (index) => ({ id: `w-${index}` }));

    expect(widgets.map((widget) => widget.id)).toEqual(['w-0', 'w-1']);
  });

  it('builds an empty list for a count of zero', () => {
    expect(aWidget.many(0)).toEqual([]);
  });
});
