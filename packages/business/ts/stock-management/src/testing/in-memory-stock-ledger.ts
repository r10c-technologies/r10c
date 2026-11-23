import type { SaleUnit } from '@r10c/business-ts-sales-vocabulary';
import { Effect } from 'effect';

import type { Reservation } from '../entities/reservation';
import { StockItem } from '../entities/stock-item';
import type { StockMovement } from '../entities/stock-movement';
import {
  type HoldOutcome,
  InsufficientStock,
  type InUnit,
  type RestoreOutcome,
  type StockLedger,
  UnitMismatch,
} from '../ports/stock-ledger';

/**
 * One offering's counters. `available` is stored and moved with the others,
 * as the Mongo ledger stores it, rather than derived on read — so the
 * contract's `available === onHand − reserved` holds this ledger to it too.
 */
interface Counter {
  /** Fixed by the first movement, as the store's upsert fixes it. */
  readonly unit: SaleUnit;
  onHand: number;
  reserved: number;
  available: number;
}

interface Shelf {
  readonly counters: Map<string, Counter>;
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
  /** The counter a movement moves, created in its unit on the first one. */
  const counterFor = (shelf: Shelf, movement: InUnit<StockMovement>) => {
    let counter = shelf.counters.get(movement.offeringId);
    if (counter === undefined) {
      counter = { unit: movement.unit, onHand: 0, reserved: 0, available: 0 };
      shelf.counters.set(movement.offeringId, counter);
    }
    return counter;
  };
  const mismatch = (
    offeringId: string,
    unit: SaleUnit,
    counter: Counter | undefined,
  ) =>
    counter === undefined || counter.unit === unit
      ? undefined
      : new UnitMismatch({ offeringId, unit, stocked: counter.unit });
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
    // A hold was only ever taken on a counter in its own unit.
    const counter = shelf.counters.get(held.reservation.offeringId) as Counter;
    counter.reserved -= held.reservation.quantity;
    // A sale leaves the shelf and the hold at once, so what is free stays.
    if (to === 'converted') counter.onHand -= held.reservation.quantity;
    else counter.available += held.reservation.quantity;
    return 'transitioned' as const;
  };

  const move = (organizationId: string, movement: InUnit<StockMovement>) => {
    const shelf = shelfOf(organizationId);
    const refused = mismatch(
      movement.offeringId,
      movement.unit,
      shelf.counters.get(movement.offeringId),
    );
    if (refused !== undefined) return refused;
    const counter = counterFor(shelf, movement);
    counter.onHand += movement.quantity;
    counter.available += movement.quantity;
    return undefined;
  };

  return {
    take: (organizationId, reservation, commandId) =>
      Effect.suspend(
        (): Effect.Effect<HoldOutcome, InsufficientStock | UnitMismatch> => {
          const key =
            commandId === undefined
              ? undefined
              : claimKey(organizationId, commandId);
          const first = key === undefined ? undefined : commands.get(key);
          if (first !== undefined) {
            return Effect.succeed({
              _tag: 'replayed' as const,
              reservation: first as Reservation,
            });
          }
          const shelf = shelfOf(organizationId);
          const counter = shelf.counters.get(reservation.offeringId);
          const refused = mismatch(
            reservation.offeringId,
            reservation.unit,
            counter,
          );
          if (refused !== undefined) return Effect.fail(refused);
          // Nothing was ever stocked: nothing is free, and no item is made.
          const available = counter?.available ?? 0;
          if (counter === undefined || available < reservation.quantity) {
            return Effect.fail(
              new InsufficientStock({
                offeringId: reservation.offeringId,
                requested: reservation.quantity,
                available,
              }),
            );
          }
          counter.reserved += reservation.quantity;
          counter.available -= reservation.quantity;
          shelf.holds.set(reservation.id as string, {
            reservation,
            status: 'held',
          });
          if (key !== undefined) commands.set(key, reservation);
          return Effect.succeed({ _tag: 'held' as const, reservation });
        },
      ),
    end: (organizationId, reservationId, to) =>
      Effect.sync(() => endHold(shelfOf(organizationId), reservationId, to)),
    record: (organizationId, movement) =>
      Effect.suspend(() => {
        const refused = move(organizationId, movement);
        return refused === undefined
          ? Effect.succeed(movement)
          : Effect.fail(refused);
      }),
    restore: (organizationId, movement, commandId) =>
      Effect.suspend((): Effect.Effect<RestoreOutcome, UnitMismatch> => {
        const key =
          commandId === undefined
            ? undefined
            : claimKey(organizationId, commandId);
        const first = key === undefined ? undefined : commands.get(key);
        if (first !== undefined) {
          return Effect.succeed({
            _tag: 'replayed' as const,
            movement: first as StockMovement,
          });
        }
        const refused = move(organizationId, movement);
        if (refused !== undefined) return Effect.fail(refused);
        if (key !== undefined) commands.set(key, movement);
        return Effect.succeed({ _tag: 'restored' as const, movement });
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
        return { released, failed: [] };
      }),
    item: (organizationId, offeringId) =>
      Effect.sync(() => {
        const counter = shelves.get(organizationId)?.counters.get(offeringId);
        return counter === undefined
          ? undefined
          : Object.assign(new StockItem(offeringId), counter);
      }),
  };
};
