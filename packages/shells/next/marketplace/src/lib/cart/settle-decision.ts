/**
 * What a flow-status read means for a checkout waiting to settle: `completed`
 * only when the flow says so, `failed` when it ended any other way, and
 * `pending` while it runs or when the read said nothing — a `404` is a flow not
 * projected yet, never one that failed (ADR 0073).
 */
export const settleDecision = (
  body: unknown,
): 'completed' | 'failed' | 'pending' => {
  const state = (body as { data?: { state?: unknown } } | undefined)?.data
    ?.state;
  if (state === 'completed') return 'completed';
  if (
    state === 'failed' ||
    state === 'compensated' ||
    state === 'interrupted'
  ) {
    return 'failed';
  }
  return 'pending';
};
