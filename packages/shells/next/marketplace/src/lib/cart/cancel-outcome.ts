/**
 * What the confirmation page is told a cancel attempt did, as a search param.
 *
 * Three outcomes, because the buyer has three different things to do next:
 * nothing (`cancelled`), wait and click again (`pending`), or stop trying
 * (`failed`).
 */
export const CancelOutcomes = ['cancelled', 'pending', 'failed'] as const;

export type CancelOutcome = (typeof CancelOutcomes)[number];

/**
 * Narrow a query param to an outcome.
 *
 * The value decides a translation key, so an arbitrary query param must not be
 * able to name one.
 */
export const isCancelOutcome = (value: unknown): value is CancelOutcome =>
  (CancelOutcomes as readonly unknown[]).includes(value);

/** What order-service's answer to a buyer's cancel means to the action. */
export type CancelStart =
  | { readonly kind: 'started'; readonly flowId: string }
  | { readonly kind: 'pending' }
  | { readonly kind: 'failed' };

/**
 * Read order-service's answer to a buyer's cancel: a `202` is a cancellation
 * started, to be followed to its end on the receipt (ADR 0073), never a
 * cancellation done.
 *
 * ⚠️ **`paymentPending` is the one refusal that is worth retrying.** The order
 * turns `paid` only once `payment.captured` is consumed off the bus, so a buyer
 * who cancels straight from the confirmation page can arrive before it. Every
 * other refusal (a closed window, an order already on its way, a network
 * failure) reads `failed`, because clicking again would not change the answer.
 */
export const cancelStartOf = (
  status: number | undefined,
  payload: unknown,
): CancelStart => {
  const body = payload as
    | { code?: unknown; meta?: { type?: unknown }; data?: { flowId?: unknown } }
    | undefined;
  const flowId = body?.data?.flowId;
  if (
    status === 202 &&
    body?.meta?.type === 'flowAccepted' &&
    typeof flowId === 'string' &&
    flowId !== ''
  )
    return { kind: 'started', flowId };
  if (status === 409 && body?.code === 'paymentPending')
    return { kind: 'pending' };
  return { kind: 'failed' };
};
