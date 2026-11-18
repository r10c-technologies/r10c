import { Stack, Text } from '@entifix/react-controls/primitives';

/** The copy the block states, resolved on the server in the buyer's locale. */
export interface DeliveryFactsLabels {
  readonly ships: string;
  readonly cod: string;
  readonly doesNotShip: string;
  readonly atTheDoor: string;
  readonly refuse: string;
  readonly noReturns: string;
}

/**
 * What a product page says about getting the product, for its seller: only
 * what the system enforces (ADR 0076 §8). Whether the seller ships and takes
 * cash on delivery — one entitlement decides both today — and what happens at
 * the door. No delivery time and no cost: nothing enforces either yet, and a
 * promise the checkout cannot keep is worse than silence.
 *
 * Two short lines, so add-to-cart stays on a 320px phone's first screen; the
 * door's terms sit behind a native disclosure, which opens without script.
 * A seller who does not ship gets one sentence instead, and the page shows no
 * Add to cart: the checkout would refuse the basket (`vendorDoesNotShip`).
 */
export function DeliveryFacts({
  ships,
  labels,
}: {
  readonly ships: boolean;
  readonly labels: DeliveryFactsLabels;
}) {
  if (!ships) {
    return (
      <Text tone="muted" data-testid="delivery-does-not-ship">
        {labels.doesNotShip}
      </Text>
    );
  }
  return (
    <Stack gap="3xs" data-testid="delivery-facts">
      <Text>{labels.ships}</Text>
      <Text data-testid="delivery-cod">{labels.cod}</Text>
      <details className="text-step--1">
        <summary className="touch-target cursor-pointer content-center font-medium">
          {labels.atTheDoor}
        </summary>
        <Stack gap="3xs">
          <Text tone="muted">{labels.refuse}</Text>
          <Text tone="muted">{labels.noReturns}</Text>
        </Stack>
      </details>
    </Stack>
  );
}
