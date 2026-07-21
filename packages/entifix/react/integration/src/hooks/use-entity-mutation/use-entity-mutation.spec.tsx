import {
  ConfigurationRepositoryTag,
  deleteUCFactory,
  EntityRepositoryTag,
  saveUCFactory,
} from '@r10c/entifix-ts-business';
import { EntifixConnError, type Entity } from '@r10c/entifix-ts-core';
import {
  makeInMemoryEntityRepository,
  makeStubConfigurationStore,
} from '@r10c/entifix-ts-testing-unit';
import { act, renderHook } from '@testing-library/react';
import { Context } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';

import { useEntityMutation } from './use-entity-mutation.js';

interface Widget extends Entity {
  name: string;
}

let repository: ReturnType<typeof makeInMemoryEntityRepository>;

const renderMutation = () =>
  renderHook(() =>
    useEntityMutation<Widget, ConfigurationRepositoryTag | EntityRepositoryTag>({
      saveUc: saveUCFactory<Widget>(),
      deleteUc: deleteUCFactory<Widget>(),
      ctx: Context.make(EntityRepositoryTag, repository).pipe(
        Context.add(ConfigurationRepositoryTag, makeStubConfigurationStore()),
      ),
    }),
  );

beforeEach(() => {
  repository = makeInMemoryEntityRepository([{ id: 'w-1', name: 'Alpha' }] as Widget[]);
});

describe('useEntityMutation', () => {
  it('starts idle', () => {
    const { result } = renderMutation();

    expect(result.current).toMatchObject({
      isSaving: false,
      isDeleting: false,
      error: undefined,
    });
  });

  it('persists an update', async () => {
    const { result } = renderMutation();

    await act(async () => {
      await result.current.save({ id: 'w-1', name: 'Renamed' });
    });

    expect((repository.items[0] as Widget | undefined)?.name).toBe('Renamed');
  });

  // A create round-trips through the store's id generation, so only the
  // returned entity is addressable — returning the input would hand the caller
  // an unsaveable record.
  it('resolves to the entity the repository returned, not the one passed in', async () => {
    const { result } = renderMutation();
    const input = { id: undefined, name: 'New' } as unknown as Widget;

    let saved: Widget | undefined;
    await act(async () => {
      saved = await result.current.save(input);
    });

    expect(saved?.id).toBeDefined();
  });

  it('reports saving while the write is in flight', async () => {
    const { result } = renderMutation();

    let pending: Promise<Widget | undefined>;
    act(() => {
      pending = result.current.save({ id: 'w-1', name: 'Renamed' });
    });
    expect(result.current.isSaving).toBe(true);

    await act(async () => {
      await pending;
    });
    expect(result.current.isSaving).toBe(false);
  });

  it('deletes by id and reports success', async () => {
    const { result } = renderMutation();

    let removed: boolean | undefined;
    await act(async () => {
      removed = await result.current.remove('w-1');
    });

    expect(removed).toBe(true);
    expect(repository.items).toEqual([]);
  });

  it('reports deleting while the delete is in flight', async () => {
    const { result } = renderMutation();

    let pending: Promise<boolean>;
    act(() => {
      pending = result.current.remove('w-1');
    });
    expect(result.current.isDeleting).toBe(true);

    await act(async () => {
      await pending;
    });
    expect(result.current.isDeleting).toBe(false);
  });

  // A failed write resolves rather than throwing: the caller is an event
  // handler, and an unhandled rejection there would take down the page.
  it('resolves to undefined and records the error when a save fails', async () => {
    repository.failNext(new EntifixConnError('unreachable'));
    const { result } = renderMutation();

    let saved: Widget | undefined | symbol = Symbol('unset');
    await act(async () => {
      saved = await result.current.save({ id: 'w-1', name: 'Renamed' });
    });

    expect(saved).toBeUndefined();
    expect(result.current.error).toBeDefined();
    expect(result.current.isSaving).toBe(false);
  });

  it('resolves to false and records the error when a delete fails', async () => {
    repository.failNext(new EntifixConnError('unreachable'));
    const { result } = renderMutation();

    let removed: boolean | undefined;
    await act(async () => {
      removed = await result.current.remove('w-1');
    });

    expect(removed).toBe(false);
    expect(result.current.error).toBeDefined();
    expect(result.current.isDeleting).toBe(false);
  });

  it.each([
    ['save', (api: ReturnType<typeof renderMutation>['result']['current']) =>
      api.save({ id: 'w-1', name: 'Renamed' })],
    ['remove', (api: ReturnType<typeof renderMutation>['result']['current']) =>
      api.remove('w-1')],
  ])('clears a previous error when the next %s starts', async (_label, run) => {
    repository.failNext(new EntifixConnError('unreachable'));
    const { result } = renderMutation();
    await act(async () => {
      await result.current.save({ id: 'w-1', name: 'Renamed' });
    });
    expect(result.current.error).toBeDefined();

    await act(async () => {
      await run(result.current);
    });

    expect(result.current.error).toBeUndefined();
  });
});
