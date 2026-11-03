import type { Overloaded, UpstreamUnavailable } from '@entifix/core';
import { Context, type Effect } from 'effect';

/**
 * The fleet's cash-on-delivery dials, from config-service: the kill switch and
 * the most a courier is trusted to carry for one vendor order, in minor units.
 */
export interface CodPolicy {
  readonly enabled: boolean;
  readonly maxAmount: number;
}

export class CodPolicyTag extends Context.Service<CodPolicyTag, CodPolicy>()(
  'CodPolicyTag',
) {}

/**
 * Whether a seller ships cash on delivery — whether their organization is
 * provisioned for `shipping-order-management`. Read from the published vendor
 * projection, which carries the fact as auth-service announced it: this slice
 * opens no other store.
 */
export interface CodAcceptance {
  readonly acceptsCod: (
    vendorId: string,
  ) => Effect.Effect<boolean, UpstreamUnavailable | Overloaded>;
}

export class CodAcceptanceTag extends Context.Service<
  CodAcceptanceTag,
  CodAcceptance
>()('CodAcceptanceTag') {}
