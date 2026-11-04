import {
  EntityIdTag,
  EntityRepositoryFactoryTag,
  EntityRepositoryTag,
  getUCFactory,
} from '@entifix/business';
import { NotFound } from '@entifix/core';
import { PublishedPriceReaderTag } from '@r10c/business-ts-catalog-contracts';
import { InvalidBody } from '@r10c/business-ts-common';
import { FlowStarterTag } from '@r10c/business-ts-flow-contracts';
import { Effect } from 'effect';

import { SalesChannel } from '../../entities/sales-channel';
import { OfferingNotYours } from '../../failures/sales-failures';
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

/** One priced counter line, as a checkout's start input carries it. */
interface PricedLine {
  readonly offeringId: string;
  readonly quantity: number;
  readonly amount: number;
  readonly currency: string;
}

/** The sale's totals, one per currency: unit price times quantity. */
const totalsOf = (lines: readonly PricedLine[]) => {
  const byCurrency = new Map<string, number>();
  for (const line of lines)
    byCurrency.set(
      line.currency,
      (byCurrency.get(line.currency) ?? 0) + line.amount * line.quantity,
    );
  return Array.from(byCurrency, ([currency, amount]) => ({ currency, amount }));
};

/**
 * Sell at the counter: **the same checkout the storefront starts**, with a
 * channel on it (ADR 0056). This process presents a crossing token on the
 * seller's behalf, so everything a token could abuse is decided here first —
 * the channel is the caller's own and active, every price comes from the
 * published projection, and every offering is the caller's to sell.
 *
 * It answers the flow it started, never the sale's outcome: the till follows
 * the flow to `flow.completed`, or to the refusal a line's hold met
 * (ADR 0066, ADR 0073).
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
    const priced: PricedLine[] = [];
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
      priced.push({
        offeringId: line.offeringId,
        quantity: line.quantity,
        amount: price.amount,
        currency: price.currency,
      });
    }

    const flows = yield* FlowStarterTag;
    return yield* flows.start(
      'checkout',
      {
        // No `buyerId`: a walk-in has no account, and `channel` explains the
        // absence. Copied, never linked — the receipt's reader holds no
        // tenant handle, and renaming a channel must not rewrite history.
        channel: {
          type: channel.type,
          id: String(channel.id),
          name: channel.name,
        },
        vendors: [
          {
            vendorId: organizationId,
            paymentMethod: sale.paymentMethod,
            lines: priced,
          },
        ],
        totals: totalsOf(priced),
      },
      idempotencyKey,
    );
  });
