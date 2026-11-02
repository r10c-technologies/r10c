import {
  EntityIdTag,
  EntityRepositoryFactoryTag,
  EntityRepositoryTag,
  getUCFactory,
} from '@entifix/business';
import { NotFound, UpstreamUnavailable } from '@entifix/core';
import { PublishedPriceReaderTag } from '@r10c/business-ts-catalog-contracts';
import { InvalidBody } from '@r10c/business-ts-common';
import {
  checkoutInputs,
  type CheckoutLineInput,
  SagaStarterTag,
} from '@r10c/business-ts-saga-contracts';
import { Effect } from 'effect';

import { SalesChannel } from '../../entities/sales-channel';
import {
  OfferingNotYours,
  StockUnavailable,
} from '../../failures/sales-failures';
import { isSalesChannelStatus, isSalesChannelType } from '../../values';
import { type CounterSalePayload, SellAtChannelUC } from '../sell-at-channel';

/**
 * A channel's own rules, checked as it is saved: a type nobody priced would
 * fall through to the default commission and bill a rate nobody agreed, and a
 * status outside the pair would leave a channel neither sellable nor retired.
 */
export const validateSalesChannel = (
  channel: SalesChannel,
): Effect.Effect<SalesChannel, InvalidBody> =>
  !isSalesChannelType(channel.type)
    ? Effect.fail(
        new InvalidBody({
          reason: `a sales channel type must be one of the declared types, not "${String(channel.type)}"`,
        }),
      )
    : !isSalesChannelStatus(channel.status)
      ? Effect.fail(
          new InvalidBody({
            reason: `a sales channel status must be active or inactive, not "${String(channel.status)}"`,
          }),
        )
      : Effect.succeed(channel);

/**
 * Sell at the counter: **the same checkout saga the storefront starts**, with
 * a channel on it (ADR 0056). This process presents a crossing token on the
 * seller's behalf, so everything a token could abuse is decided here first —
 * the channel is the caller's own and active, every price comes from the
 * published projection, and every offering is the caller's to sell.
 *
 * A channel this organization does not have is **not found** rather than
 * forbidden: the id is the store's key, and a 403 would make the route an
 * oracle for which channels exist elsewhere.
 */
export const sellAtCounter = (input: {
  readonly organizationId: string;
  readonly channelId: string;
  readonly sale: CounterSalePayload;
  /** The checkout start's key: a repeated sale under it runs one flow. */
  readonly idempotencyKey: string;
}) =>
  Effect.gen(function* () {
    const { organizationId, channelId, sale, idempotencyKey } = input;
    const factory = yield* EntityRepositoryFactoryTag;
    const repository = yield* factory.for(SalesChannel, { organizationId });

    const found = yield* getUCFactory<SalesChannel>().pipe(
      Effect.provideService(EntityRepositoryTag, repository),
      Effect.provideService(EntityIdTag, channelId),
      Effect.catch(() => Effect.succeed(undefined)),
    );
    if (found === undefined) {
      return yield* new NotFound({ entity: 'sales-channel' });
    }
    const channel = yield* SellAtChannelUC.run(found);

    const prices = yield* PublishedPriceReaderTag;
    const priced: CheckoutLineInput[] = [];
    for (const line of sale.lines) {
      const price = yield* prices.priceOf(line.offeringId);
      if (price === undefined) {
        return yield* new InvalidBody({
          reason: `nothing published answers to the offering "${line.offeringId}"`,
        });
      }
      // Here rather than at the reserve: by then this process has already
      // presented a token that can name any organization.
      if (price.vendorId !== organizationId) {
        return yield* new OfferingNotYours({ offeringId: line.offeringId });
      }
      priced.push({ ...price, quantity: line.quantity });
    }

    const sagas = yield* SagaStarterTag;
    const outcome = yield* sagas.start(
      'checkout',
      checkoutInputs({
        lines: priced,
        order: {
          // No `buyerId`: a walk-in has no account, and `channel` explains
          // the absence. Copied, never linked — the receipt's reader holds no
          // tenant handle, and renaming a channel must not rewrite history.
          channel: {
            id: String(channel.id),
            name: channel.name,
            type: channel.type,
          },
        },
        payment: {
          paymentMethod: sale.paymentMethod,
          fallbackCurrency: 'GTQ',
          channelId: String(channel.id),
        },
      }),
      idempotencyKey,
    );

    switch (outcome._tag) {
      case 'completed':
        return outcome.result;
      case 'compensated':
        return yield* new StockUnavailable({ channelId });
      case 'failed':
        return yield* new UpstreamUnavailable({
          upstream: 'transaction-service',
        });
    }
  });
