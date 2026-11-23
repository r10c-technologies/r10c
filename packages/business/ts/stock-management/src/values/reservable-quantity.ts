/**
 * Can this quantity be held?
 *
 * Strictly positive: a reservation of zero holds nothing while still occupying a
 * row and an id, and a negative one would *release* stock through the route that
 * takes it — `$inc: { reserved: -1 }` on a hold is an oversell nobody asked for.
 *
 * An integer in the unit's scale (ADR 0082 §2): 1.5 kg is held as `1500` in
 * `KG`, so a fraction is a quantity that lost its unit. `NaN` and the
 * infinities are refused with it, and that is a refusal rather than a
 * nicety — `$inc` by `NaN` writes `NaN` into `reserved`, which no later
 * reservation, release or adjustment can move back.
 */
export function isReservableQuantity(quantity: number): boolean {
  return Number.isSafeInteger(quantity) && quantity > 0;
}
