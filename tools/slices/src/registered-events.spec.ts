// Loaded for their registrations: each contracts package registers the events
// it owns at module load, and `@entifix/transactions` registers `transaction.*`
// and `flow.*`. Importing them is what puts the fleet's schemas in this
// process's registry.
import '@r10c/business-ts-catalog-contracts';
import '@r10c/business-ts-order-contracts';
import '@r10c/business-ts-party-contracts';
import '@r10c/business-ts-payment-contracts';
import '@entifix/transactions';

import { registeredEvents } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { matchesPattern } from './fleet.js';
import { SLICES } from './registry.js';
import type { SliceDeclaration } from './types.js';

/**
 * Every published event and every subscription in `slices` that names no
 * registered schema. A pattern counts as registered when it matches one.
 */
const unregistered = (slices: readonly SliceDeclaration[]): string[] => {
  const names = registeredEvents().map(entry => entry.name);
  const declared = slices.flatMap(slice => [
    ...slice.publishedEvents.map(event => `${slice.name} publishes ${event}`),
    ...slice.subscriptions.map(
      subscription => `${slice.name} subscribes to ${subscription.event}`,
    ),
  ]);
  return declared.filter(line => {
    const event = line.split(' ').at(-1) ?? '';
    return !names.some(name => matchesPattern(event, name));
  });
};

describe('Every event the register names has a schema (ADR 0068)', () => {
  it('finds the registrations it is meant to check', () => {
    expect(registeredEvents().map(entry => entry.name)).toEqual(
      expect.arrayContaining([
        'catalog.published',
        'order.placed',
        'flow.started',
      ]),
    );
  });

  it('registers every published and subscribed event', () => {
    expect(unregistered(SLICES)).toEqual([]);
  });

  it('catches an event with no schema (planted)', () => {
    const planted: SliceDeclaration = {
      ...(SLICES[0] as SliceDeclaration),
      name: 'planted',
      publishedEvents: ['planted.unregistered'],
      subscriptions: [],
    };

    expect(unregistered([planted])).toEqual([
      'planted publishes planted.unregistered',
    ]);
  });
});
