import type { CommandGroup } from '@r10c/entifix-ts-core';
import {
  makeInMemoryUiPreferencesState,
  renderWithAdapters,
} from '@r10c/entifix-ts-testing-unit/react';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCommandRecency } from './use-command-recency.js';

const group = (ids: string[], key = 'commands'): CommandGroup => ({
  key,
  label: 'Comandos',
  options: ids.map(id => ({ id, label: id, href: `/${id}` })),
  isLoading: false,
});

/**
 * Renders the hook inside the preferences provider `renderWithAdapters` mounts,
 * and hands the result back through a ref — `renderHook` cannot take the
 * provider that helper supplies.
 *
 * The seed key carries **no** `r10c-ui:` prefix: the namespace is the shipped
 * adapters' doing, not the port's, and this double stores exactly the key
 * `useUiPreference` passes it.
 */
const mount = (seed: Record<string, unknown> = {}) => {
  const preferences = makeInMemoryUiPreferencesState(seed);
  const held: { current?: ReturnType<typeof useCommandRecency> } = {};

  function Subject() {
    held.current = useCommandRecency();
    return null;
  }

  renderWithAdapters(<Subject />, { preferences });
  return { held, preferences };
};

describe('useCommandRecency', () => {
  it('leaves a group untouched before anything has been stored', () => {
    const { held } = mount();

    expect(held.current?.rank(group(['a', 'b'])).options.map(o => o.id)).toEqual(
      ['a', 'b'],
    );
  });

  it('offers the most recently used command first', async () => {
    const { held } = mount({
      'back-office:command-recency': { b: 10, a: 5 },
    });

    await waitFor(() =>
      expect(
        held.current?.rank(group(['a', 'b'])).options.map(o => o.id),
      ).toEqual(['b', 'a']),
    );
  });

  it('never reorders a record group — those ids are primary keys', async () => {
    const { held } = mount({
      'back-office:command-recency': { 'record:x:2': 10 },
    });

    await waitFor(() =>
      expect(
        held
          .current!.rank(group(['record:x:1', 'record:x:2'], 'record:x'))
          .options.map(o => o.id),
      ).toEqual(['record:x:1', 'record:x:2']),
    );
  });

  it('remembers a command that was just run', async () => {
    const { held, preferences } = mount();

    act(() => held.current?.remember('a'));

    await waitFor(() =>
      expect(
        preferences.entries['back-office:command-recency'],
      ).toHaveProperty('a'),
    );
  });

  it('keeps the record bounded, so a preference cannot grow forever', async () => {
    const seeded = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`old-${index}`, index + 1]),
    );
    const { held, preferences } = mount({
      'back-office:command-recency': seeded,
    });

    await waitFor(() =>
      expect(held.current?.rank(group(['old-0'])).options).toHaveLength(1),
    );
    act(() => held.current?.remember('fresh'));

    await waitFor(() => {
      const stored = preferences.entries[
        'back-office:command-recency'
      ] as Record<string, number>;
      expect(Object.keys(stored)).toHaveLength(20);
      expect(stored).toHaveProperty('fresh');
      // The oldest entry is the one that fell off, not an arbitrary one.
      expect(stored).not.toHaveProperty('old-0');
    });
  });
});
