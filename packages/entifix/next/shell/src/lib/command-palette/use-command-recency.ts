'use client';

import { useUiPreference } from '@r10c/entifix-react-controls';
import type { CommandGroup } from '@r10c/entifix-ts-core';
import { useCallback, useMemo } from 'react';

/** `namespace:` is prepended by the store → `r10c-ui:back-office:command-recency`. */
const RECENCY_PREF_KEY = 'back-office:command-recency';

/**
 * How many commands are remembered.
 *
 * A cap rather than an unbounded map: the store writes the whole record on every
 * run, and a record that only ever grows is a preference that gets slower for
 * the rest of the person's account life. Twenty is far more than the number of
 * commands anyone reaches for.
 */
const RECENCY_LIMIT = 20;

export interface CommandRecency {
  /** Reorder a group's options, most recently used first. */
  readonly rank: (group: CommandGroup) => CommandGroup;
  /** Remember that this command was just run. */
  readonly remember: (id: string) => void;
}

/**
 * Which commands this person reaches for, and in what order to offer them.
 *
 * **Recency reorders within a group and never across groups.** Group order is
 * the ranking (ADR 0040), and it is fixed precisely so an operator learns where
 * a kind of result lands; letting use move a whole group would take that away
 * for a convenience nobody asked for. Inside a group there is no such contract,
 * so the last thing you ran comes first.
 *
 * Stored as **one keyed record**, not a key per command — the same reasoning
 * `back-office:nav-collapsed-groups` records: `useUiPreference` resolves after
 * mount, so N keys are N first-paint transitions while one read settles the
 * whole palette at once.
 *
 * A record group is deliberately left alone: its options are records, whose ids
 * are primary keys, so remembering them would build a list of which records this
 * person opened inside a UI preference. Only commands and destinations are
 * ranked.
 */
export function useCommandRecency(): CommandRecency {
  const { value, setValue } = useUiPreference<Record<string, number>>(
    RECENCY_PREF_KEY,
    {},
  );

  const rank = useCallback(
    (group: CommandGroup): CommandGroup => {
      if (group.key.startsWith('record:')) return group;

      const options = [...group.options].sort(
        (left, right) => (value[right.id] ?? 0) - (value[left.id] ?? 0),
      );
      return { ...group, options };
    },
    [value],
  );

  const remember = useCallback(
    (id: string) => {
      const next = { ...value, [id]: Date.now() };
      const kept = Object.entries(next)
        .sort(([, left], [, right]) => right - left)
        .slice(0, RECENCY_LIMIT);
      setValue(Object.fromEntries(kept));
    },
    [value, setValue],
  );

  return useMemo(() => ({ rank, remember }), [rank, remember]);
}
