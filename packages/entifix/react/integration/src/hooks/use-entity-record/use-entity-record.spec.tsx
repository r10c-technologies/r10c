import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
  getUCFactory,
} from '@r10c/entifix-ts-business';
import { type Entity, type EntityId } from '@r10c/entifix-ts-core';
import {
  makeInMemoryEntityRepository,
  makeStubConfigurationStore,
} from '@r10c/entifix-ts-testing-unit';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Context } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';

import { useEntityRecord } from './use-entity-record.js';

interface Widget extends Entity {
  name: string;
}

let repository: ReturnType<typeof makeInMemoryEntityRepository>;

const makeContext = () =>
  Context.make(EntityRepositoryTag, repository).pipe(
    Context.add(ConfigurationRepositoryTag, makeStubConfigurationStore()),
  );

const renderRecord = (id: EntityId) =>
  renderHook(
    ({ recordId }: { recordId: EntityId }) =>
      useEntityRecord<Widget, ConfigurationRepositoryTag | EntityRepositoryTag>({
        uc: getUCFactory<Widget>(),
        ctx: makeContext(),
        id: recordId,
      }),
    { initialProps: { recordId: id } },
  );

beforeEach(() => {
  repository = makeInMemoryEntityRepository([
    { id: 'w-1', name: 'Alpha' },
    { id: 'w-2', name: 'Beta' },
  ] as Widget[]);
});

describe('useEntityRecord', () => {
  it('loads the record for the given id', async () => {
    const { result } = renderRecord('w-1');

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect((result.current.entity as Widget | undefined)?.name).toBe('Alpha');
    expect(result.current.error).toBeUndefined();
  });

  // The create case: there is no record yet, so not fetching is correct — and
  // it must not look like a failure either.
  it('does not fetch at all without an id', () => {
    const { result } = renderRecord(undefined);

    expect(result.current.isLoading).toBe(false);
    expect(result.current.entity).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  it('refetches when the id changes', async () => {
    const { result, rerender } = renderRecord('w-1');
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    rerender({ recordId: 'w-2' });
    await waitFor(() =>
      expect((result.current.entity as Widget | undefined)?.name).toBe('Beta'),
    );
  });

  it('refetches on demand through reload', async () => {
    const { result } = renderRecord('w-1');
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    repository.seed([{ id: 'w-1', name: 'Renamed' }] as Widget[]);

    act(() => result.current.reload());

    await waitFor(() =>
      expect((result.current.entity as Widget | undefined)?.name).toBe('Renamed'),
    );
  });

  // A save returns the stored entity; `setEntity` is how a form adopts it
  // without paying for another round trip.
  it('replaces the held record through setEntity', async () => {
    const { result } = renderRecord('w-1');
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setEntity({ id: 'w-1', name: 'Locally saved' } as Widget));

    expect((result.current.entity as Widget | undefined)?.name).toBe('Locally saved');
  });

  it('clears the held record through setEntity(undefined)', async () => {
    const { result } = renderRecord('w-1');
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setEntity(undefined));

    expect(result.current.entity).toBeUndefined();
  });

  it('surfaces a failure for an unknown id', async () => {
    const { result } = renderRecord('missing');

    await waitFor(() => expect(result.current.error).toBeDefined());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.entity).toBeUndefined();
  });

  it('does not refetch when only the caller’s objects change identity', async () => {
    const { result, rerender } = renderRecord('w-1');
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    rerender({ recordId: 'w-1' });
    rerender({ recordId: 'w-1' });

    expect(result.current.isLoading).toBe(false);
  });

  it.each([
    ['a response', false],
    ['a failure', true],
  ])('ignores %s that lands after unmount', async (_label, shouldFail) => {
    const { result, unmount } = renderRecord(shouldFail ? 'missing' : 'w-1');

    unmount();

    await waitFor(() => {
      expect(result.current.entity).toBeUndefined();
      expect(result.current.error).toBeUndefined();
    });
  });
});
