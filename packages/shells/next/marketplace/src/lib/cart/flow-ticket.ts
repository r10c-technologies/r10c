/**
 * What the storefront remembers about one checkout it started, until its flow
 * settles: the flow, the capability that lets an anonymous buyer hear it, the
 * cancel nonce the group was opened with, and the `Idempotency-Key` a retry
 * reuses so a retried checkout is the same flow, not a second one (ADR 0073).
 *
 * ⚠️ **`httpOnly`, always.** The capability and the nonce are bearer
 * credentials; the RSC hands the capability to the order-status island as a
 * prop, so it never sits in storage a script could read across pages.
 */
export const FLOW_COOKIE = 'r10c_flow';

/** A checkout settles well inside the cancel window the receipt opens. */
export const FLOW_TTL_SECONDS = 1800;

export interface FlowTicket {
  readonly flowId: string;
  readonly capability: string;
  readonly cancelNonce: string;
  readonly idempotencyKey: string;
}

export const serializeFlowTicket = (ticket: FlowTicket): string =>
  JSON.stringify(ticket);

const filled = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

/** A ticket read back strictly: anything but four filled strings is none. */
export const parseFlowTicket = (
  raw: string | undefined,
): FlowTicket | undefined => {
  if (raw === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const { flowId, capability, cancelNonce, idempotencyKey } = value as Record<
    string,
    unknown
  >;
  return filled(flowId) &&
    filled(capability) &&
    filled(cancelNonce) &&
    filled(idempotencyKey)
    ? { flowId, capability, cancelNonce, idempotencyKey }
    : undefined;
};
