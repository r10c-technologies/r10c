import { describe, expect, it } from 'vitest';

import {
  accessor,
  cloneEntityDraft,
  Entity,
  entity,
  EntityId,
  reconstructEntity,
} from '../../index.js';

@entity({ key: 'clonable' })
class Clonable implements Entity {
  #id?: EntityId;
  #code?: string;
  #name?: string;
  #createdBy?: string;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  /** A unique identifier the store assigns — a copy must not carry it. */
  @accessor({ type: 'string', resetOnClone: true })
  get code(): string | undefined {
    return this.#code;
  }
  set code(value: string | undefined) {
    this.#code = value;
  }

  @accessor({ type: 'string' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }

  /** An audit stamp: the route owns it, so a copy starts without one. */
  @accessor({ type: 'string', resetOnClone: true })
  get createdBy(): string | undefined {
    return this.#createdBy;
  }
  set createdBy(value: string | undefined) {
    this.#createdBy = value;
  }
}

const draft = {
  id: '7',
  code: 'BR-0007',
  name: 'Acme',
  createdBy: 'ada',
};

describe('cloneEntityDraft', () => {
  it('carries every member the copy may keep', () => {
    expect(cloneEntityDraft(Clonable, draft).name).toBe('Acme');
  });

  /**
   * The one outcome a Clone button must never produce: carrying the id makes
   * the "copy" an update to the original.
   */
  it('always clears the identity member, with no flag', () => {
    expect(cloneEntityDraft(Clonable, draft).id).toBe('');
  });

  it('clears every member declared resetOnClone', () => {
    const cloned = cloneEntityDraft(Clonable, draft);

    expect(cloned.code).toBe('');
    expect(cloned.createdBy).toBe('');
  });

  /**
   * `''`, not deletion: an input handed `undefined` flips from controlled to
   * uncontrolled, which is the trap `restoreEntityDraft` layers over a seeded
   * draft to avoid.
   */
  it('clears to the empty string rather than removing the key', () => {
    const cloned = cloneEntityDraft(Clonable, draft);

    expect('code' in cloned).toBe(true);
    expect(cloned.code).toBe('');
  });

  /**
   * The case that matters most, because it is the ordinary one: every
   * generated catalog form hides its id, and `describeEntityColumns` drops
   * `hidden` members — so a descriptor-driven sweep would leave the id in
   * place on exactly the forms a Clone button appears on, and the copy would
   * save over the original.
   */
  it('clears a hidden id, which no descriptor reports', () => {
    @entity({ key: 'hidden-id' })
    class HiddenId implements Entity {
      #id?: EntityId;
      #name?: string;

      @accessor({ type: 'id', hidden: true })
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

    expect(cloneEntityDraft(HiddenId, { id: '7', name: 'Acme' })).toEqual({
      id: '',
      name: 'Acme',
    });
  });

  it('does not invent a key the draft never held', () => {
    expect(cloneEntityDraft(Clonable, { name: 'Acme' })).toEqual({
      name: 'Acme',
    });
  });

  it('leaves the original draft untouched', () => {
    const original = { ...draft };
    cloneEntityDraft(Clonable, original);

    expect(original).toEqual(draft);
  });

  /**
   * The pair that matters: a cloned draft reconstructs into a record with no
   * id, which is what makes the submit a create rather than an update.
   */
  it('reconstructs into a record the store will treat as new', () => {
    const cloned = reconstructEntity(
      Clonable,
      cloneEntityDraft(Clonable, draft),
    );

    expect(cloned.id).toBeUndefined();
    expect(cloned.code).toBeUndefined();
    expect(cloned.name).toBe('Acme');
  });
});
