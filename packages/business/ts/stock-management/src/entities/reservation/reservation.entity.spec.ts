import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { Reservation } from './reservation.entity.js';

describe('Reservation', () => {
  it('serializes the hold with its expiry', () => {
    const expiresAt = new Date('2026-08-12T10:00:00.000Z');
    const reservation = new Reservation('offering-1', 2);
    reservation.id = 'res-1';
    reservation.expiresAt = expiresAt;

    expect(serializeEntity(Reservation, reservation)).toEqual({
      id: 'res-1',
      offeringId: 'offering-1',
      quantity: 2,
      status: 'held',
      expiresAt,
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const reservation = await Effect.runPromise(
      deserializeSingleEntity(Reservation, {
        id: 'res-2',
        offeringId: 'offering-2',
        quantity: 1,
        status: 'converted',
        expiresAt: new Date('2026-08-12T11:00:00.000Z'),
      }),
    );

    expect(reservation?.status).toBe('converted');
    expect(reservation?.quantity).toBe(1);
  });

  it('opens as `held`, so a new hold is holding stock before anything else runs', () => {
    const reservation = new Reservation();

    expect(reservation.offeringId).toBe('');
    expect(reservation.quantity).toBe(0);
    expect(reservation.status).toBe('held');
    expect(reservation.expiresAt).toBeUndefined();
  });

  it('accepts the setters a repository writes back through', () => {
    const reservation = new Reservation();
    reservation.offeringId = 'offering-3';
    reservation.quantity = 4;
    reservation.status = 'released';
    reservation.expiresAt = undefined;

    expect(reservation.offeringId).toBe('offering-3');
    expect(reservation.quantity).toBe(4);
    expect(reservation.status).toBe('released');
    expect(reservation.expiresAt).toBeUndefined();
  });

  it('makes the release sweep expressible as a query', () => {
    // The sweep is "expired and still held", so both members it names have to
    // be in the allowlist — member metadata is also the server-side filter
    // allowlist, and a sweep that cannot filter would have to read everything.
    const byName = new Map(
      describeEntityColumns(Reservation).map(column => [column.name, column]),
    );

    expect(byName.get('expiresAt')?.filterable).toBe(true);
    expect(byName.get('expiresAt')?.type).toBe('date');
    expect(byName.get('status')?.filterable).toBe(true);
  });

  it('holds no quantity for the order, only its own', () => {
    // order-management holds a reservation *id*, never a quantity — which is
    // what lets a failed order compensate by releasing rather than by reversing
    // arithmetic it never performed.
    const names = describeEntityColumns(Reservation).map(column => column.name);

    expect(names).toEqual([
      'id',
      'offeringId',
      'quantity',
      'status',
      'expiresAt',
    ]);
  });
});
