import type { RequestPrincipal } from '@entifix/business';
import type { AudienceRecipient } from '@entifix/core';
import { resolveRequestPrincipal } from '@entifix/service-shell';
import { digestFlowCapability } from '@entifix/transactions';
import { Effect, Option } from 'effect';

/** The browser's parameter name for a flow capability (`@entifix/react-integration`). */
export const CAPABILITY_PARAM = 'capability';

/** How many capabilities one request may present. */
export const MAX_CAPABILITIES = 64;

/** Who is asking: the verified member, if any, and what they may be addressed as. */
export interface Caller {
  readonly member?: RequestPrincipal;
  readonly recipient: AudienceRecipient & {
    readonly flowDigests: readonly string[];
  };
}

/**
 * The caller of a realtime request: a verified session (the `entifix_at`
 * cookie or a bearer), the flow capabilities it presents, or both.
 *
 * ⚠️ **A capability is compared by digest and never kept.** It is hashed here,
 * at the edge of the request, and only the digest travels on — into the
 * audience match, never into a log or a store.
 */
export const resolveCaller = (capabilities: readonly string[]) =>
  Effect.gen(function* () {
    const principal = Option.getOrUndefined(yield* resolveRequestPrincipal);
    const flowDigests = yield* Effect.forEach(
      Array.from(new Set(capabilities)),
      digestFlowCapability,
    );
    const caller: Caller = {
      ...(principal === undefined ? {} : { member: principal }),
      recipient: {
        ...(principal?.organizationId === undefined
          ? {}
          : { organizationId: principal.organizationId }),
        ...(principal?.partyId === undefined
          ? {}
          : { partyId: principal.partyId }),
        flowDigests,
      },
    };
    return caller;
  });

/** Whether the caller could be admitted by any audience at all. */
export const identifies = ({ member, recipient }: Caller): boolean =>
  member !== undefined || recipient.flowDigests.length > 0;
