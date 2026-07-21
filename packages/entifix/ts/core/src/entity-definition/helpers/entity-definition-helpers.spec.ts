import { describe, expect, it } from 'vitest';

import { EntifixBuildError } from '../../base-entities/entifix-error/index.js';
import type { Entity, EntityConstructor, EntityId } from '../../types/Entity.js';
import { accessor } from '../decorators/accessor/index.js';
import { entity } from '../decorators/entity/index.js';
import { method } from '../decorators/method/index.js';
import { MetaAccessor } from '../meta-entities/meta-accessor/index.js';
import { MetaEntity } from '../meta-entities/meta-entity/index.js';
import { MetaMethod } from '../meta-entities/meta-method/index.js';
import {
  appendMetaAccessor,
  appendMetaMethod,
  extractMetaAccessors,
  extractMetaEntity,
  extractMetaMethods,
  setMetaEntity,
} from './entity-definition-helpers.js';

@entity({ key: 'gadget', domain: 'catalog' })
class Gadget implements Entity {
  #id?: EntityId;
  #label?: string;
  #writeOnly?: string;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ label: 'Label', order: 2 })
  get label(): string | undefined {
    return this.#label;
  }
  set label(value: string | undefined) {
    this.#label = value;
  }

  // Decorated on the *setter*, which is the other kind the registry records.
  get writeOnly(): string | undefined {
    return this.#writeOnly;
  }
  @accessor()
  set writeOnly(value: string | undefined) {
    this.#writeOnly = value;
  }

  @method({ http: { method: 'POST', path: '/recalibrate' }, returnType: 'void' })
  recalibrate(): void {
    this.#label = 'recalibrated';
  }

  @method()
  reset(): void {
    this.#label = undefined;
  }
}

/** Decorated with nothing at all — the empty case every extractor must handle. */
class Bare implements Entity {
  id: EntityId;
}

describe('@entity', () => {
  it('registers the class name plus its key and domain', () => {
    const meta = extractMetaEntity(Gadget);

    expect(meta).toBeInstanceOf(MetaEntity);
    expect(meta.name).toBe('Gadget');
    expect(meta.key).toBe('gadget');
    expect(meta.domain).toBe('catalog');
  });

  it('leaves key and domain undefined when no options are given', () => {
    @entity()
    class Plain implements Entity {
      id: EntityId;
    }

    const meta = extractMetaEntity(Plain);

    expect(meta.key).toBeUndefined();
    expect(meta.domain).toBeUndefined();
  });
});

describe('@accessor', () => {
  it('records each decorated member in declaration order', () => {
    expect(extractMetaAccessors(Gadget).map((meta) => meta.name)).toEqual([
      'id',
      'label',
      'writeOnly',
    ]);
  });

  it('records the accessor kind, which is what the serializer filters on', () => {
    const byName = new Map(
      extractMetaAccessors(Gadget).map((meta) => [meta.name, meta]),
    );

    expect(byName.get('id')?.kind).toBe('getter');
    expect(byName.get('writeOnly')?.kind).toBe('setter');
  });

  it('carries the declared presentation options through', () => {
    const label = extractMetaAccessors(Gadget).find((meta) => meta.name === 'label');

    expect(label).toBeInstanceOf(MetaAccessor);
    expect(label?.label).toBe('Label');
    expect(label?.order).toBe(2);
  });

  it('leaves every option undefined when none are given', () => {
    const writeOnly = extractMetaAccessors(Gadget).find(
      (meta) => meta.name === 'writeOnly',
    );

    expect(writeOnly?.type).toBeUndefined();
    expect(writeOnly?.hidden).toBeUndefined();
    expect(writeOnly?.enumValues).toBeUndefined();
    expect(writeOnly?.linkLabelProperty).toBeUndefined();
  });
});

describe('@method', () => {
  it('records each decorated method with its HTTP binding', () => {
    const metas = extractMetaMethods(Gadget);

    expect(metas.map((meta) => meta.name)).toEqual(['recalibrate', 'reset']);
    expect(metas[0]).toBeInstanceOf(MetaMethod);
    expect(metas[0]?.http).toEqual({ method: 'POST', path: '/recalibrate' });
    expect(metas[0]?.returnType).toBe('void');
  });

  it('leaves the binding undefined when no options are given', () => {
    const reset = extractMetaMethods(Gadget).find((meta) => meta.name === 'reset');

    expect(reset?.http).toBeUndefined();
    expect(reset?.returnType).toBeUndefined();
  });

  it('does not disturb the method it decorates', () => {
    const gadget = new Gadget();
    gadget.recalibrate();

    expect(gadget.label).toBe('recalibrated');
  });
});

describe('extractors on an undecorated class', () => {
  it('fails loudly for a missing MetaEntity, naming the class', () => {
    expect(() => extractMetaEntity(Bare)).toThrow(EntifixBuildError);
    expect(() => extractMetaEntity(Bare)).toThrow(/MetaEntity not found for Bare/);
  });

  it.each([
    ['accessors', extractMetaAccessors],
    ['methods', extractMetaMethods],
  ])('yields an empty %s list', (_label, extract) => {
    expect(
      extract(Bare as unknown as EntityConstructor<Entity>),
    ).toEqual([]);
  });
});

// Without `Symbol.metadata` there is no place to hang the registry, and a
// silent no-op would leave adapters seeing an entity with no members at all.
describe('missing decorator metadata', () => {
  const message = /Decorator metadata unavailable/;

  it('rejects setMetaEntity', () => {
    expect(() => setMetaEntity(undefined, new MetaEntity('X'))).toThrow(message);
  });

  it('rejects appendMetaAccessor', () => {
    expect(() => appendMetaAccessor(undefined, new MetaAccessor('x', 'getter'))).toThrow(
      message,
    );
  });

  it('rejects appendMetaMethod', () => {
    expect(() => appendMetaMethod(undefined, new MetaMethod('x'))).toThrow(message);
  });
});

describe('appending onto a bare metadata object', () => {
  it('starts an accessor list and then extends it', () => {
    const metadata = {} as DecoratorMetadataObject;

    appendMetaAccessor(metadata, new MetaAccessor('first', 'getter'));
    appendMetaAccessor(metadata, new MetaAccessor('second', 'setter'));

    const target = { [Symbol.metadata]: metadata } as unknown as EntityConstructor<Entity>;
    expect(extractMetaAccessors(target).map((meta) => meta.name)).toEqual([
      'first',
      'second',
    ]);
  });

  it('starts a method list and then extends it', () => {
    const metadata = {} as DecoratorMetadataObject;

    appendMetaMethod(metadata, new MetaMethod('first'));
    appendMetaMethod(metadata, new MetaMethod('second'));

    const target = { [Symbol.metadata]: metadata } as unknown as EntityConstructor<Entity>;
    expect(extractMetaMethods(target).map((meta) => meta.name)).toEqual([
      'first',
      'second',
    ]);
  });
});

describe('metadata carried on a null slot', () => {
  it('is treated as absent rather than throwing', () => {
    const target = {
      name: 'NullMetadata',
      [Symbol.metadata]: null,
    } as unknown as EntityConstructor<Entity>;

    expect(extractMetaAccessors(target)).toEqual([]);
    expect(() => extractMetaEntity(target)).toThrow(EntifixBuildError);
  });
});
