import {
  defineEntityApi,
  type EntityApiContext,
  type EntityApiRequest,
  IdempotencyKeyTag,
  verbEndpoint,
} from '@entifix/business';
import { entityKey, makeEnvelope } from '@entifix/core';
import {
  type CounterSalePayload,
  SalesChannel,
  SellAtChannelUC,
  sellAtCounter,
  validateSalesChannel,
} from '@r10c/business-ts-sales-management';
import { Effect } from 'effect';

/**
 * sales-service's records: a vendor's channels, authored by a member of the
 * organization that owns them — a session bound to that organization is the
 * only credential any endpoint here accepts ([ADR 0024](../../../../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)).
 *
 * ⚠️ **`sell` is a write this slice does not persist.** It starts the checkout
 * flow, which reserves stock, writes the order and captures the payment
 * through the slices that own those stores. Only once the use case has decided
 * the sale is the caller's to make does this process present the coordinator's
 * crossing token on their behalf ([ADR 0056](../../../../../../docs/adr/0056-the-counter-sale-is-the-checkout-saga.md)).
 * Its `Idempotency-Key` is the checkout start's, so a till that retries a sale
 * runs one flow: the coordinator's record is the one layer that claims it.
 */
export const salesChannelApi = defineEntityApi(
  SalesChannel,
  entityKey(SalesChannel, 'sales-channel'),
  {
    verbs: ['list', 'get', 'create', 'update', 'delete'],
    guard: { kind: 'organization' },
    prepare: validateSalesChannel,
    useCases: [
      // Answered `202` with the checkout to follow, never with its outcome.
      verbEndpoint(SellAtChannelUC, {
        idempotent: 'unit',
        accepted: true,
        handler: (request: EntityApiRequest, context: EntityApiContext) =>
          Effect.gen(function* () {
            const accepted = yield* sellAtCounter({
              // The organization guard always names one.
              organizationId: context.organizationId as string,
              channelId: request.params?.id as string,
              sale: request.payload as CounterSalePayload,
              idempotencyKey: yield* IdempotencyKeyTag,
            });
            return makeEnvelope('flowAccepted', 'counter-sale', accepted);
          }),
      }),
    ],
  },
);
