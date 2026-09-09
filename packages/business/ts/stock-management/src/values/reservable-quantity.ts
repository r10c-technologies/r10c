/**
 * Can this quantity be held?
 *
 * Strictly positive: a reservation of zero holds nothing while still occupying a
 * row and an id, and a negative one would *release* stock through the route that
 * takes it — `$inc: { reserved: -1 }` on a hold is an oversell nobody asked for.
 *
 * `Number.isFinite` rather than `Number.isInteger`, for the reason
 * `isConsistentMovement` records: a vendor selling by weight reserves 1.5 kg,
 * and rejecting that would make the rule wrong rather than strict. What is
 * rejected is `NaN` and the infinities, and that is a refusal rather than a
 * nicety — `$inc` by `NaN` writes `NaN` into `reserved`, which no later
 * reservation, release or adjustment can move back.
 */
export function isReservableQuantity(quantity: number): boolean {
  return Number.isFinite(quantity) && quantity > 0;
}
