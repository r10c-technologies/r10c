/**
 * The stock rows the `mock` profile serves.
 *
 * Deliberately the same shape and the same offering ids as the seed
 * stock-service inserts (`apps/stock-service/src/stock-temp-data.ts`), and the
 * same four shapes it cycles — a lone receipt, a receipt and a sale, a fold of
 * three, and one cancelled to zero. So a journey asserting `product-offering-1`
 * holds ten reads the same story in either profile.
 *
 * It is copied rather than imported: an e2e project reaching into another app's
 * source would couple two runtimes together, and this is fixture data — if the
 * two ever diverge, the shared journeys fail, which is the signal we want.
 *
 * ⚠️ `product-offering-41` is absent on purpose, matching the tail the service
 * seed leaves unstocked. "No row" is a different state from zero on hand.
 */
export const stockItemSeed = [
  {
    id: 'stock-item-1',
    offeringId: 'product-offering-1',
    onHand: 10,
    reserved: 0,
  },
  {
    id: 'stock-item-2',
    offeringId: 'product-offering-2',
    onHand: 13,
    reserved: 0,
  },
  {
    id: 'stock-item-3',
    offeringId: 'product-offering-3',
    onHand: 17,
    reserved: 2,
  },
  {
    id: 'stock-item-4',
    offeringId: 'product-offering-4',
    onHand: 0,
    reserved: 0,
  },
];

export const stockMovementSeed = [
  {
    id: 'stock-movement-1-1',
    offeringId: 'product-offering-1',
    quantity: 10,
    reason: 'receipt',
  },
  {
    id: 'stock-movement-2-1',
    offeringId: 'product-offering-2',
    quantity: 17,
    reason: 'receipt',
  },
  {
    id: 'stock-movement-2-2',
    offeringId: 'product-offering-2',
    quantity: -4,
    reason: 'sale',
  },
  {
    id: 'stock-movement-3-1',
    offeringId: 'product-offering-3',
    quantity: 24,
    reason: 'receipt',
  },
  {
    id: 'stock-movement-3-2',
    offeringId: 'product-offering-3',
    quantity: -6,
    reason: 'sale',
  },
  {
    id: 'stock-movement-3-3',
    offeringId: 'product-offering-3',
    quantity: -1,
    reason: 'adjustment',
  },
];

/**
 * One hold, so the expiry a vendor's support answer depends on is visible in a
 * journey. Written by the checkout crossing in the real system — never here by
 * a person, which is why the screen that shows it has no create.
 */
export const reservationSeed = [
  {
    id: 'reservation-1',
    offeringId: 'product-offering-3',
    quantity: 2,
    status: 'held',
    expiresAt: '2026-12-01T00:00:00.000Z',
  },
];
