import { Effect } from 'effect';

import type { Reservation } from '../entities/reservation';
import type { StockMovement } from '../entities/stock-movement';
import type { StockLedger } from '../ports/stock-ledger';

interface Shelf {
  readonly counters: Map<string, { onHand: number; reserved: number }>;
  readonly holds: Map<string, { reservation: Reservation; status: string }>;
}

/**
 * A {@link StockLedger} held in memory, for the specs of whatever consumes the
 * port. It runs `describeStockLedgerContract`, so it is held to the same rules
 * as the Mongo ledger rather than being a more forgiving copy of it.
 */
export const makeInMemoryStockLedger = (): StockLedger => {
  const shelves = new Map<string, Shelf>();
  const commands = new Map<string, Reservation | StockMovement>();

  const shelfOf = (organizationId: string) => {
    let shelf = shelves.get(organizationId);
    if (shelf === undefined) {
      shelf = { counters: new Map(), holds: new Map() };
      shelves.set(organizationId, shelf);
    }
    return shelf;
  };
  const counterOf = (shelf: Shelf, offeringId: string) => {
    let counter = shelf.counters.get(offeringId);
    if (counter === undefined) {
      counter = { onHand: 0, reserved: 0 };
      shelf.counters.set(offeringId, counter);
    }
    return counter;
  };
  const claimKey = (organizationId: string, commandId: string) =>
    `${organizationId}:${commandId}`;

  const endHold = (
    shelf: Shelf,
    reservationId: string,
    to: 'released' | 'converted',
  ) => {
    const held = shelf.holds.get(reservationId);
    if (held === undefined || held.status !== 'held') {
      return 'not-held' as const;
    }
    held.status = to;
    const counter = counterOf(shelf, held.reservation.offeringId);
    counter.reserved -= held.reservation.quantity;
    if (to === 'converted') counter.onHand -= held.reservation.quantity;
    return 'transitioned' as const;
  };

  const move = (organizationId: string, movement: StockMovement) => {
    counterOf(shelfOf(organizationId), movement.offeringId).onHand +=
      movement.quantity;
  };

  return {
    take: (organizationId, reservation, commandId) =>
      Effect.sync(() => {
        const key =
          commandId === undefined
            ? undefined
            : claimKey(organizationId, commandId);
        const first = key === undefined ? undefined : commands.get(key);
        if (first !== undefined) {
          return { _tag: 'replayed', reservation: first as Reservation };
        }
        const shelf = shelfOf(organizationId);
        const counter = counterOf(shelf, reservation.offeringId);
        if (counter.onHand - counter.reserved < reservation.quantity) {
          return { _tag: 'insufficient' };
        }
        counter.reserved += reservation.quantity;
        shelf.holds.set(reservation.id as string, {
          reservation,
          status: 'held',
        });
        if (key !== undefined) commands.set(key, reservation);
        return { _tag: 'held', reservation };
      }),
    end: (organizationId, reservationId, to) =>
      Effect.sync(() => endHold(shelfOf(organizationId), reservationId, to)),
    record: (organizationId, movement) =>
      Effect.sync(() => {
        move(organizationId, movement);
        return movement;
      }),
    restore: (organizationId, movement, commandId) =>
      Effect.sync(() => {
        const key =
          commandId === undefined
            ? undefined
            : claimKey(organizationId, commandId);
        const first = key === undefined ? undefined : commands.get(key);
        if (first !== undefined) {
          return { _tag: 'replayed', movement: first as StockMovement };
        }
        move(organizationId, movement);
        if (key !== undefined) commands.set(key, movement);
        return { _tag: 'restored', movement };
      }),
    releaseExpired: () =>
      Effect.sync(() => {
        let released = 0;
        for (const shelf of Array.from(shelves.values())) {
          for (const [id, held] of Array.from(shelf.holds)) {
            const expiresAt = held.reservation.expiresAt;
            if (
              held.status === 'held' &&
              expiresAt !== undefined &&
              expiresAt.getTime() < Date.now()
            ) {
              endHold(shelf, id, 'released');
              released += 1;
            }
          }
        }
        return released;
      }),
  };
};
