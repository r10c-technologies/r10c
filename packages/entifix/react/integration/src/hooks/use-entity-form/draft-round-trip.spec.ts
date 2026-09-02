import {
  accessor,
  describeEntityColumns,
  type Entity,
  entity,
  EntityCollectionLink,
  type EntityId,
  EntityLink,
  reconstructEntity,
} from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import { seedEntityDraft } from './use-entity-form.helpers.js';

/**
 * `seedEntityDraft` (here) and `reconstructEntity` (core) are the two halves of
 * one contract, and they live in different packages: core sits below the react
 * layer and cannot import this side, so neither package's own spec can assert
 * that they are inverses. This file is the only place that can.
 *
 * It matters because the disagreements are silent. `Number('')` is `0` and a
 * cleared checkbox drafts as `''`, so a coercion written in the obvious order
 * turns a blank numeric field into a real zero and an unchecked box into
 * `undefined` — both of which survive validation and reach the service.
 */
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

/** One member per `MetaAccessorType`, so no branch of either half is untested. */
@entity({ key: 'round-trip' })
class RoundTrip implements Entity {
  #id?: EntityId;
  #name?: string;
  #quantity?: number;
  #active = false;
  #releasedAt?: Date;
  #tier?: string;
  #brand = new EntityLink(Brand);
  #tags = new EntityCollectionLink(Tag);
  #labels: readonly string[] = [];
  #lines: readonly object[] = [];

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

  @accessor({ type: 'link' })
  get brand(): EntityLink<Brand> {
    return this.#brand;
  }

  @accessor({ type: 'linkCollection' })
  get tags(): EntityCollectionLink<Tag> {
    return this.#tags;
  }

  @accessor({ type: 'scalarCollection' })
  get labels(): readonly string[] {
    return this.#labels;
  }
  set labels(value: readonly string[]) {
    this.#labels = value;
  }

  @accessor({ type: 'composition', childType: () => Brand })
  get lines(): readonly object[] {
    return this.#lines;
  }
  set lines(value: readonly object[]) {
    this.#lines = value;
  }
}

const descriptors = describeEntityColumns(RoundTrip, new RoundTrip());

/** Seed a draft, rebuild from it, seed again — the second draft must match. */
function roundTrip(record: RoundTrip): {
  before: Record<string, string>;
  after: Record<string, string>;
} {
  const before = seedEntityDraft(descriptors, record);
  const rebuilt = reconstructEntity(RoundTrip, before);
  return { before, after: seedEntityDraft(descriptors, rebuilt) };
}

describe('draft round trip', () => {
  it('is a fixed point for a fully populated record', () => {
    const record = new RoundTrip();
    record.id = 'record-1';
    record.name = 'Widget';
    record.quantity = 42;
    record.active = true;
    record.releasedAt = new Date('2026-01-15T00:00:00.000Z');
    record.tier = 'gold';
    record.brand.setId('brand-1');
    record.labels = ['red', 'green'];
    record.lines = [{ sku: 'a' }];

    const { before, after } = roundTrip(record);

    expect(after).toEqual(before);
  });

  it('is a fixed point for an empty record', () => {
    const { before, after } = roundTrip(new RoundTrip());

    expect(after).toEqual(before);
    // The two disagreements that would survive validation: a blank numeric
    // field must not come back as `0`, and a cleared checkbox must come back
    // as `false` rather than absent.
    expect(before.quantity).toBe('');
    expect(after.quantity).toBe('');
    expect(after.active).toBe('false');
  });

  it('is a fixed point for a record whose booleans are false', () => {
    const record = new RoundTrip();
    record.name = 'Widget';
    record.active = false;

    const { before, after } = roundTrip(record);

    expect(after).toEqual(before);
  });

  it('rebuilds every member with the type the entity declared', () => {
    const record = new RoundTrip();
    record.quantity = 42;
    record.active = true;
    record.releasedAt = new Date('2026-01-15T00:00:00.000Z');

    const rebuilt = reconstructEntity(
      RoundTrip,
      seedEntityDraft(descriptors, record),
    );

    // The draft is strings throughout; what comes back must not be.
    expect(rebuilt.quantity).toBe(42);
    expect(rebuilt.active).toBe(true);
    expect(rebuilt.releasedAt).toBeInstanceOf(Date);
  });

  /**
   * ⚠️ Worth knowing why this assertion is here and not in the fixed-point
   * tests above. Before `scalarCollection` existed the member was declared
   * `string`, so `seedFieldValue` produced `'a,b'` through
   * `Array.prototype.toString` and `coerceFieldValue` handed the same `'a,b'`
   * straight back — as a string. The record came out of a save holding one
   * comma-joined value where it had held two, and **the round trip was still a
   * fixed point**, because both halves were wrong in the same direction. Only
   * checking the rebuilt member's actual type catches that class of bug.
   */
  it('rebuilds a scalar collection as an array, not as its own comma list', () => {
    const record = new RoundTrip();
    record.labels = ['red', 'green'];

    const rebuilt = reconstructEntity(
      RoundTrip,
      seedEntityDraft(descriptors, record),
    );

    expect(rebuilt.labels).toEqual(['red', 'green']);
  });
});
