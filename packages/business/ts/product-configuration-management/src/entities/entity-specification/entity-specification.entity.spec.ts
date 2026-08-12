import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { EntitySpecification } from './entity-specification.entity.js';

describe('EntitySpecification', () => {
  it('serializes a named version and whether it is frozen', () => {
    const specification = new EntitySpecification('Footwear', 2);
    specification.id = 'spec-1';
    specification.released = true;

    expect(serializeEntity(EntitySpecification, specification)).toEqual({
      id: 'spec-1',
      name: 'Footwear',
      version: 2,
      released: true,
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const specification = await Effect.runPromise(
      deserializeSingleEntity(EntitySpecification, {
        id: 'spec-2',
        name: 'Apparel',
        version: 7,
        released: false,
      }),
    );

    expect(specification?.name).toBe('Apparel');
    expect(specification?.version).toBe(7);
    expect(specification?.released).toBe(false);
  });

  it('starts at version 1, unreleased and therefore still editable', () => {
    const specification = new EntitySpecification();

    expect(specification.name).toBe('');
    expect(specification.version).toBe(1);
    expect(specification.released).toBe(false);
  });

  it('accepts the setters a repository writes back through', () => {
    const specification = new EntitySpecification();
    specification.name = 'Electronics';
    specification.version = 3;
    specification.released = true;

    expect(specification.name).toBe('Electronics');
    expect(specification.version).toBe(3);
    expect(specification.released).toBe(true);
  });

  it('makes released versions findable, since only those may be pinned', () => {
    // An offering pins a version, and an unreleased draft must not be
    // pinnable — member metadata is also the server-side allowlist, so the
    // authoring UI's query depends on this flag being filterable.
    const released = describeEntityColumns(EntitySpecification).find(
      column => column.name === 'released',
    );

    expect(released?.type).toBe('boolean');
    expect(released?.filterable).toBe(true);
  });

  it('versions by a member rather than by mutating a single row', () => {
    // Immutability after release is what lets a compiled-spec cache never
    // invalidate and a publication dedupe by content hash. Both depend on the
    // version being part of the record's identity, not a timestamp beside it.
    const names = describeEntityColumns(EntitySpecification).map(
      column => column.name,
    );

    expect(names).toEqual(['id', 'name', 'version', 'released']);
  });
});
