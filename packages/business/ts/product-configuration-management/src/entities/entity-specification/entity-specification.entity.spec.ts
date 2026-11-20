import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { EntitySpecification } from './entity-specification.entity.js';

describe('EntitySpecification', () => {
  it('serializes a named version and where it stands', () => {
    const specification = new EntitySpecification('Footwear', 2);
    specification.id = 'spec-1';
    specification.lifecycleStatus = 'active';

    expect(serializeEntity(EntitySpecification, specification)).toEqual({
      id: 'spec-1',
      name: 'Footwear',
      version: 2,
      lifecycleStatus: 'active',
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const specification = await Effect.runPromise(
      deserializeSingleEntity(EntitySpecification, {
        id: 'spec-2',
        name: 'Apparel',
        version: 7,
        lifecycleStatus: 'in-design',
      }),
    );

    expect(specification?.name).toBe('Apparel');
    expect(specification?.version).toBe(7);
    expect(specification?.lifecycleStatus).toBe('in-design');
  });

  it('starts at version 1, in design and therefore still editable', () => {
    const specification = new EntitySpecification();

    expect(specification.name).toBe('');
    expect(specification.version).toBe(1);
    expect(specification.lifecycleStatus).toBe('in-design');
  });

  it('accepts the setters a repository writes back through', () => {
    const specification = new EntitySpecification();
    specification.name = 'Electronics';
    specification.version = 3;
    specification.lifecycleStatus = 'active';

    expect(specification.name).toBe('Electronics');
    expect(specification.version).toBe(3);
    expect(specification.lifecycleStatus).toBe('active');
  });

  it('makes active versions findable, since only those may be pinned', () => {
    // An offering pins a version, and one still in design must not be
    // pinnable — member metadata is also the server-side allowlist, so the
    // authoring UI's query depends on the lifecycle being filterable.
    const lifecycle = describeEntityColumns(EntitySpecification).find(
      column => column.name === 'lifecycleStatus',
    );

    expect(lifecycle?.type).toBe('enum');
    expect(lifecycle?.filterable).toBe(true);
  });

  it('versions by a member rather than by mutating a single row', () => {
    // Immutability after release is what lets a compiled-spec cache never
    // invalidate and a publication dedupe by content hash. Both depend on the
    // version being part of the record's identity, not a timestamp beside it.
    const names = describeEntityColumns(EntitySpecification).map(
      column => column.name,
    );

    expect(names).toEqual([
      'id',
      'name',
      'version',
      'lifecycleStatus',
      'revision',
    ]);
  });
});
