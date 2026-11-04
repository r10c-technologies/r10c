/**
 * What the storefront remembers about one cancellation it started, until its
 * flow settles: the flow, the capability that lets an anonymous buyer hear it,
 * and the vendor order it cancels (ADR 0073).
 *
 * ⚠️ **`httpOnly`, always.** The capability is a bearer credential; the RSC
 * hands it to the receipt's island as a prop, never to storage a script reads.
 */
export const CANCEL_COOKIE = 'r10c_cancel';

/** A cancellation settles well inside the window the receipt still has open. */
export const CANCEL_TTL_SECONDS = 600;

export interface CancelTicket {
  readonly flowId: string;
  readonly capability: string;
  readonly orderId: string;
}

export const serializeCancelTicket = (ticket: CancelTicket): string =>
  JSON.stringify(ticket);

const filled = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

/** A ticket read back strictly: anything but three filled strings is none. */
export const parseCancelTicket = (
  raw: string | undefined,
): CancelTicket | undefined => {
  if (raw === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const { flowId, capability, orderId } = value as Record<string, unknown>;
  return filled(flowId) && filled(capability) && filled(orderId)
    ? { flowId, capability, orderId }
    : undefined;
};
