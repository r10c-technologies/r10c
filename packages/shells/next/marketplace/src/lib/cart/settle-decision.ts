/**
 * What a flow-status read means for a checkout waiting to settle: `completed`
 * when the flow says so — or when it parked past its commit point, waiting on
 * a seller to confirm a payment link, since everything the buyer is owed a
 * receipt for has landed (ADR 0073, ADR 0081 §2) — `failed` when it ended any
 * other way, and `pending` while it runs or when the read said nothing — a
 * `404` is a flow not projected yet, never one that failed.
 */
export const settleDecision = (
  body: unknown,
): 'completed' | 'failed' | 'pending' => {
  const data = (
    body as { data?: { state?: unknown; committed?: unknown } } | undefined
  )?.data;
  const state = data?.state;
  if (state === 'completed') return 'completed';
  if (state === 'waiting' && data?.committed === true) return 'completed';
  if (
    state === 'failed' ||
    state === 'compensated' ||
    state === 'interrupted'
  ) {
    return 'failed';
  }
  return 'pending';
};
