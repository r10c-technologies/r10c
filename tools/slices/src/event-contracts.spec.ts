// Loaded for their registrations, as `registered-events.spec.ts` loads them.
import '@r10c/business-ts-catalog-contracts';
import '@r10c/business-ts-order-contracts';
import '@r10c/business-ts-party-contracts';
import '@r10c/business-ts-payment-contracts';
import '@r10c/business-ts-shipping-order-management';
import '@r10c/business-ts-stock-management';
import '@entifix/transactions';

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { registeredEvents } from '@entifix/core';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { matchesPattern } from './fleet.js';
import { SLICES } from './registry.js';
import type { SliceDeclaration } from './types.js';

/**
 * Every registered event's contract, committed (ADR 0078 §3). A contract is
 * stable — a member is added and never removed, renamed or given a second
 * meaning — and this file is where a change to one becomes a reviewed line.
 */
const FILE = join(import.meta.dirname, '../event-contracts.json');

/** Set to rewrite {@link FILE} on purpose, once every subscriber has moved. */
const UPDATE = process.env['UPDATE_EVENT_CONTRACTS'] === '1';

export interface EventContract {
  readonly name: string;
  readonly versioned: boolean;
  readonly audience: 'required' | 'none';
  readonly fingerprint: string;
  readonly schema: unknown;
}

const fingerprintOf = (contract: Omit<EventContract, 'fingerprint'>) =>
  createHash('sha256')
    .update(JSON.stringify(contract))
    .digest('hex')
    .slice(0, 16);

/** The contracts this process registered, ordered by name. */
export const currentContracts = (): EventContract[] =>
  registeredEvents().map(entry => {
    const contract = {
      name: entry.name,
      versioned: entry.versioned,
      audience: entry.audience,
      schema: Schema.toJsonSchemaDocument(entry.schema),
    };
    return {
      name: contract.name,
      versioned: contract.versioned,
      audience: contract.audience,
      fingerprint: fingerprintOf(contract),
      schema: contract.schema,
    };
  });

/** The slices whose subscriptions an event `name` is delivered to. */
const subscribersOf = (
  slices: readonly SliceDeclaration[],
  name: string,
): string[] =>
  slices
    .filter(slice =>
      slice.subscriptions.some(({ event }) => matchesPattern(event, name)),
    )
    .map(slice => slice.name);

/**
 * Every contract that differs from the committed one — changed, added or gone —
 * as a line naming each slice that subscribes to it, because those are the
 * consumers that move in the same change (ADR 0078 §3: no compatibility
 * machinery, producer and consumers move together and the lab resets).
 */
export const changedContracts = (
  committed: readonly Pick<EventContract, 'name' | 'fingerprint'>[],
  current: readonly Pick<EventContract, 'name' | 'fingerprint'>[],
  slices: readonly SliceDeclaration[],
): string[] => {
  const before = new Map(committed.map(c => [c.name, c.fingerprint]));
  const after = new Map(current.map(c => [c.name, c.fingerprint]));
  const names = [...new Set([...before.keys(), ...after.keys()])].sort();
  return names.flatMap(name => {
    const was = before.get(name);
    const is = after.get(name);
    if (was === is) return [];
    const change =
      was === undefined ? 'added' : is === undefined ? 'removed' : 'changed';
    const subscribers = subscribersOf(slices, name);
    return [
      `${name} ${change}; subscribed by ${
        subscribers.length === 0 ? 'no slice' : subscribers.join(', ')
      }`,
    ];
  });
};

const serialized = (contracts: readonly EventContract[]) =>
  `${JSON.stringify({ events: contracts }, null, 2)}\n`;

describe('An event contract changes only on purpose (ADR 0078 §3)', () => {
  it('finds the contracts it is meant to check', () => {
    expect(currentContracts().map(c => c.name)).toEqual(
      expect.arrayContaining([
        'order.placed',
        'payment.captured',
        'stock-movement.recorded',
      ]),
    );
  });

  it('matches every committed fingerprint', () => {
    const current = currentContracts();
    if (UPDATE || !existsSync(FILE)) {
      writeFileSync(FILE, serialized(current));
    }
    const committed = (
      JSON.parse(readFileSync(FILE, 'utf8')) as {
        events: readonly EventContract[];
      }
    ).events;

    expect(
      changedContracts(committed, current, SLICES),
      'An event contract moved. Move every subscriber named here in the same ' +
        'change, then regenerate with ' +
        '`UPDATE_EVENT_CONTRACTS=1 pnpm nx test @r10c/slices` and reset the lab. ' +
        'A different meaning is a different event name, never a new shape ' +
        'under the old one.',
    ).toEqual([]);
  });

  it('names every subscriber of a changed contract (planted)', () => {
    const current = currentContracts();
    const planted = current.map(c =>
      c.name === 'order.placed' ? { ...c, fingerprint: 'planted' } : c,
    );

    expect(changedContracts(planted, current, SLICES)).toEqual([
      'order.placed changed; subscribed by accounting, realtime, settlement, transaction',
    ]);
  });

  it('names a contract added or removed (planted)', () => {
    expect(
      changedContracts(
        [{ name: 'planted.gone', fingerprint: 'a' }],
        [{ name: 'planted.new', fingerprint: 'b' }],
        SLICES,
      ),
    ).toEqual([
      'planted.gone removed; subscribed by no slice',
      'planted.new added; subscribed by no slice',
    ]);
  });
});
