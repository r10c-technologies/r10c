// Loaded for their registrations, as `registered-events.spec.ts` does: the
// audience requirement is read off the registry, so the schemas of every
// pushable event have to be in this process.
import '@r10c/business-ts-catalog-contracts';
import '@r10c/business-ts-order-contracts';
import '@r10c/business-ts-payment-contracts';
import '@r10c/business-ts-flow-contracts';
import '@entifix/transactions';

import { registeredEvents } from '@entifix/core';
import { PUSH_PROJECTIONS } from '@r10c/shells-effect-realtime';
import { describe, expect, it } from 'vitest';

import { matchesPattern } from './fleet.js';
import { SLICES } from './registry.js';
import type { SliceDeclaration } from './types.js';

const broadcasts = (slices: readonly SliceDeclaration[]) =>
  slices.flatMap(slice =>
    slice.subscriptions
      .filter(subscription => subscription.mode === 'broadcast')
      .map(subscription => ({ slice: slice.name, event: subscription.event })),
  );

/**
 * Every broadcast subscription with no push projection. A broadcast queue
 * exists to reach browsers, and what a browser may hear is decided by a
 * projection — one with none would push a domain event's payload as-is, which
 * is the leak ADR 0072 put the projection there to prevent.
 */
const unprojected = (
  slices: readonly SliceDeclaration[],
  projections: Readonly<Record<string, unknown>>,
) =>
  broadcasts(slices)
    .filter(({ event }) => projections[event] === undefined)
    .map(({ slice, event }) => `${slice} broadcasts ${event}`);

/**
 * Every pushable event whose registration does not require `meta.audience`.
 * The filter fails closed, so such an event would be written, relayed and
 * pushed to nobody — silently, which is the direction a missing check hides.
 */
const audienceOptional = (events: readonly string[]) => {
  const registered = registeredEvents();
  return events.filter(event =>
    registered
      .filter(entry => matchesPattern(event, entry.name))
      .some(entry => entry.audience !== 'required'),
  );
};

describe('What a browser hears is projected (ADR 0072)', () => {
  it('finds the broadcast subscriptions it is meant to check', () => {
    expect(broadcasts(SLICES).length).toBeGreaterThanOrEqual(6);
  });

  it('projects every broadcast subscription', () => {
    expect(unprojected(SLICES, PUSH_PROJECTIONS)).toEqual([]);
  });

  it('catches an unprojected broadcast (planted)', () => {
    const planted: SliceDeclaration = {
      ...(SLICES[0] as SliceDeclaration),
      name: 'planted',
      subscriptions: [
        {
          event: 'payment.captured',
          mode: 'broadcast',
          maxAttempts: 5,
          dedupe: 'natural',
          dedupeReason: 'planted',
        },
      ],
    };

    expect(unprojected([planted], PUSH_PROJECTIONS)).toEqual([
      'planted broadcasts payment.captured',
    ]);
  });

  it('requires an audience on every pushable event', () => {
    expect(
      audienceOptional([
        ...broadcasts(SLICES).map(({ event }) => event),
        'entity.changed',
      ]),
    ).toEqual([]);
  });

  it('catches a pushable event registered with no audience (planted)', () => {
    // `payment.captured` is registered `audience: 'none'`, which is exactly
    // why it is not pushed until a capture is allocated per order (#480).
    expect(audienceOptional(['payment.captured'])).toEqual([
      'payment.captured',
    ]);
  });
});
