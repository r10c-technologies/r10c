import type { EnumTone } from '@entifix/core';
import { Effect } from 'effect';

/**
 * Where one version of a specification stands — SID's lifecycle, four states
 * ([ADR 0079](../../../../../docs/adr/0079-a-published-specification-is-versioned-and-a-save-names-the-revision-it-read.md) §1):
 *
 * - `in-design` — the only state with an edit path;
 * - `active` — frozen, and the only state an offering may be published on;
 * - `retired` — no new pin, pins already taken keep working;
 * - `obsolete` — nothing live pins it, and it is kept forever: orders name it.
 */
export const SpecificationLifecycleStatuses = [
  'in-design',
  'active',
  'retired',
  'obsolete',
] as const;

export type SpecificationLifecycleStatus =
  (typeof SpecificationLifecycleStatuses)[number];

/**
 * A state read at a glance: the version on sale succeeds, one still being
 * written warns, and a withdrawn one is neutral — a state with no tone reads
 * neutral.
 */
export const SpecificationLifecycleTones = {
  'in-design': 'warning',
  active: 'success',
} as const satisfies Readonly<
  Partial<Record<SpecificationLifecycleStatus, EnumTone>>
>;

/**
 * The moves a person makes on one version. `revise` is a move on the **key**:
 * it leaves the active version where it stands and opens the next one in
 * design, which is why it is in the table with no resulting state.
 */
export const SpecificationMoves = [
  'release',
  'revise',
  'retire',
  'obsolete',
] as const;

export type SpecificationMove = (typeof SpecificationMoves)[number];

/**
 * The whole rule, as a table. `revise` maps `active` to itself because the
 * version it is asked on does not move; the clone is a new record.
 */
const MOVES: Record<
  SpecificationMove,
  Partial<Record<SpecificationLifecycleStatus, SpecificationLifecycleStatus>>
> = {
  release: { 'in-design': 'active' },
  revise: { active: 'active' },
  retire: { active: 'retired' },
  obsolete: { retired: 'obsolete' },
};

/** The state a move leaves the version in, or `undefined` when it is illegal. */
export function specificationStatusAfter(
  current: SpecificationLifecycleStatus | undefined,
  move: SpecificationMove,
): SpecificationLifecycleStatus | undefined {
  return current === undefined ? undefined : MOVES[move][current];
}

/** The states a move is legal from — what its verb is offered in. */
export function specificationStatusesBefore(
  move: SpecificationMove,
): readonly SpecificationLifecycleStatus[] {
  return Object.keys(MOVES[move]) as SpecificationLifecycleStatus[];
}

/**
 * The members a release freezes: what the specification **says**. Its
 * identity, version and lifecycle stamps are not content, and `revision` moves
 * with every save.
 */
export const SPECIFICATION_CONTENT = [
  'code',
  'name',
  'description',
  'brandId',
  'categoryId',
  'media',
  'fitsDeviceModelIds',
] as const;

/** Keys sorted at every depth, so equal content always prints the same. */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter(key => record[key] !== undefined)
        .map(key => [key, canonical(record[key])]),
    );
  }
  return value;
};

/**
 * The SHA-256 of a version's content, hex — stamped at release, so a version
 * that was ever changed after it was frozen is detectable by recomputing it.
 * Web Crypto, not `node:crypto`: this package runs in a browser too.
 */
export const contentHashOf = (
  specification: Partial<
    Record<(typeof SPECIFICATION_CONTENT)[number], unknown>
  >,
): Effect.Effect<string> =>
  Effect.promise(async () => {
    const content = Object.fromEntries(
      SPECIFICATION_CONTENT.map(member => [member, specification[member]]),
    );
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(canonical(content))),
    );
    return Array.from(new Uint8Array(digest), byte =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
  });
