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
import {
  type KitStock,
  kitTakenOf,
  lineTotal,
  type PricePer,
  saleLineRefusal,
  type SaleUnit,
  type StockSource,
  tieredPrice,
} from '@r10c/business-ts-sales-vocabulary';
import {
  type BuyerTax,
  BuyerTaxIdInvalid,
  BuyerTaxIdTypeUnknown,
  BuyerTaxNameRequired,
  buyerTaxOf,
} from '@r10c/business-ts-tax-policy';
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

/**
 * One priced counter line, as a checkout's start input carries it. A
 * presentation's line also states the base it draws on, as published; the
 * coordinator multiplies and reserves on the base (ADR 0082 §7).
 */
interface PricedLine extends Partial<StockSource> {
  readonly kitComponents?: readonly KitStock[];
  readonly offeringId: string;
  /**
   * What it is sold as, from the same projection as its price: the name, the
   * description and the specification version (#582, ADR 0079 §3).
   */
  readonly name: string;
  readonly description?: string;
  readonly specificationId: string;
  readonly specificationVersion: number;
  /** What one is, and how many in its scale (ADR 0082 §2). */
  readonly saleUnit: SaleUnit;
  readonly quantity: number;
  /**
   * What `pricePer` whole units cost at this quantity: the published price,
   * or the volume price it reached (ADR 0082 §8).
   */
  readonly amount: number;
  readonly pricePer: PricePer;
  /** Where that volume price starts, when the line reached one. */
  readonly tierFrom?: number;
  readonly currency: string;
}

/**
 * The sale's totals, one per currency, as the coordinator will state them
 * again: each line's `lineTotal` — never a price times a quantity here
 * (ADR 0082 §6).
 */
const totalsOf = (lines: readonly PricedLine[]) => {
  const byCurrency = new Map<string, number>();
  for (const line of lines)
    byCurrency.set(
      line.currency,
      (byCurrency.get(line.currency) ?? 0) + lineTotal(line),
    );
  return Array.from(byCurrency, ([currency, amount]) => ({ currency, amount }));
};

/**
 * The buyer's fiscal identity as the till gave it, or the typed refusal the
 * storefront and the coordinator answer the same input with. Absent is a
 * consumidor final.
 */
export const counterBuyerTax = (
  input: CounterSalePayload['buyerTax'],
): Effect.Effect<
  BuyerTax,
  BuyerTaxIdTypeUnknown | BuyerTaxIdInvalid | BuyerTaxNameRequired
> => {
  const outcome = buyerTaxOf(input ?? {});
  if (outcome.ok) return Effect.succeed(outcome.value);
  switch (outcome.problem) {
    case 'invalidTaxIdType':
      return Effect.fail(new BuyerTaxIdTypeUnknown({}));
    case 'invalidTaxId':
      return Effect.fail(
        new BuyerTaxIdInvalid({
          idType: input?.idType === 'cui' ? 'cui' : 'nit',
        }),
      );
    case 'missingName':
      return Effect.fail(new BuyerTaxNameRequired({}));
  }
};

/**
 * The till's lines with each offering once, its quantities summed, in the
 * order each first appeared. Two lines of one offering would compose to two
 * holds with one step name and one idempotency key, so the second would
 * answer the first's hold (ADR 0086 §4); one line of the sum is what was sold.
 * The sum is then checked against the terms like any other quantity.
 */
export const mergedLines = <
  TLine extends { readonly offeringId: string; readonly quantity: number },
>(
  lines: readonly TLine[],
): TLine[] => {
  const byOffering = new Map<string, TLine>();
  for (const line of lines) {
    const seen = byOffering.get(line.offeringId);
    byOffering.set(
      line.offeringId,
      seen === undefined
        ? line
        : { ...seen, quantity: seen.quantity + line.quantity },
    );
  }
  return Array.from(byOffering.values());
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
    const buyerTax = yield* counterBuyerTax(sale.buyerTax);

    const prices = yield* PublishedPriceReaderTag;
    const priced: PricedLine[] = [];
    for (const line of mergedLines(sale.lines)) {
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
      // The volume price this quantity reaches, chosen here from what the
      // projection publishes — never from what the till sent (ADR 0082 §8).
      const charged = tieredPrice(price, line.quantity);
      // The decision (ADR 0082 §3): checked against the terms the projection
      // publishes, refused rather than rounded — whatever the till showed.
      const refused = saleLineRefusal(line.offeringId, line.quantity, price, {
        amount: charged.amount,
        pricePer: price.pricePer,
      });
      if (refused !== undefined) return yield* refused;
      priced.push({
        offeringId: line.offeringId,
        name: price.name,
        ...(price.description === undefined
          ? {}
          : { description: price.description }),
        specificationId: price.specificationId,
        specificationVersion: price.specificationVersion,
        saleUnit: price.saleUnit,
        quantity: line.quantity,
        amount: charged.amount,
        pricePer: price.pricePer,
        ...(charged.tierFrom === undefined
          ? {}
          : { tierFrom: charged.tierFrom }),
        currency: price.currency,
        ...(price.stockOfferingId === undefined
          ? {}
          : {
              stockOfferingId: price.stockOfferingId,
              stockFactor: price.stockFactor,
              stockUnit: price.stockUnit,
            }),
        // A kit holds each component's stock, as published (ADR 0086).
        ...kitTakenOf(price),
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
        buyerTax: {
          idType: buyerTax.idType,
          taxId: buyerTax.taxId,
          name: buyerTax.name,
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
