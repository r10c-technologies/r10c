import {
  EntityIdTag,
  EntityRepositoryFactoryTag,
  EntityRepositoryTag,
  getUCFactory,
} from '@entifix/business';
import { EntifixBuildError, EntifixConnError } from '@entifix/core';
import { PublishedPriceReaderTag } from '@r10c/business-ts-catalog-contracts';
import {
  checkoutInputs,
  type CheckoutLineInput,
  SagaStarterTag,
} from '@r10c/business-ts-saga-contracts';
import { Effect } from 'effect';

import { SalesChannel } from '../../entities/sales-channel';
import { isSalesChannelStatus, isSalesChannelType } from '../../values';
import { SellAtChannelUC } from '../sell-at-channel';

/** What a till asks for: a channel, the goods, and how the buyer paid. */
export interface CounterSaleRequest {
  readonly channelId: string;
  readonly lines: ReadonlyArray<{
    readonly offeringId: string;
    readonly quantity: number;
  }>;
  readonly paymentMethod: string;
}

/** Why a counter sale was refused before anything was dispatched. */
export class CounterSaleRefused {
  readonly _tag = 'CounterSaleRefused';
  constructor(
    readonly code: 'invalidBody' | 'notFound' | 'channelInactive' | 'notYours',
    readonly detail: string,
  ) {}
}

export type CounterSaleOutcome =
  | { readonly _tag: 'sold'; readonly result: unknown }
  /** A line could not be held, and every hold taken was given back. */
  | { readonly _tag: 'unavailable' };

const isPositiveWhole = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

/**
 * Read a till's body, or `undefined` when it is not one: a channel, a payment
 * method, and at least one line of a positive whole quantity. **No price is
 * read** — a price in the body would be the one input that must never be the
 * caller's.
 */
export const readCounterSale = (
  body: unknown,
): CounterSaleRequest | undefined => {
  if (typeof body !== 'object' || body === null) return undefined;
  const { channelId, lines, paymentMethod } = body as Record<string, unknown>;
  if (typeof channelId !== 'string' || channelId.length === 0) return undefined;
  if (typeof paymentMethod !== 'string' || paymentMethod.length === 0) {
    return undefined;
  }
  if (!Array.isArray(lines) || lines.length === 0) return undefined;
  const parsed: { offeringId: string; quantity: number }[] = [];
  for (const line of lines as unknown[]) {
    const { offeringId, quantity } = (line ?? {}) as Record<string, unknown>;
    if (typeof offeringId !== 'string' || !isPositiveWhole(quantity)) {
      return undefined;
    }
    parsed.push({ offeringId, quantity });
  }
  return { channelId, lines: parsed, paymentMethod };
};

/**
 * A channel's own rules, checked as it is saved: a type nobody priced would
 * fall through to the default commission and bill a rate nobody agreed, and a
 * status outside the pair would leave a channel neither sellable nor retired.
 */
export const validateSalesChannel = (
  channel: SalesChannel,
): EntifixBuildError | undefined =>
  !isSalesChannelType(channel.type)
    ? new EntifixBuildError(
        `A sales channel type must be one of the declared types, not "${String(channel.type)}"`,
      )
    : !isSalesChannelStatus(channel.status)
      ? new EntifixBuildError(
          `A sales channel status must be active or inactive, not "${String(channel.status)}"`,
        )
      : undefined;

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
  readonly sale: CounterSaleRequest;
}) =>
  Effect.gen(function* () {
    const { organizationId, sale } = input;
    const factory = yield* EntityRepositoryFactoryTag;
    const repository = yield* factory.for(SalesChannel, { organizationId });

    const channel = yield* getUCFactory<SalesChannel>().pipe(
      Effect.provideService(EntityRepositoryTag, repository),
      Effect.provideService(EntityIdTag, sale.channelId),
      Effect.catch(() => Effect.succeed(undefined)),
    );
    if (channel === undefined) {
      return yield* Effect.fail(
        new CounterSaleRefused('notFound', 'no such sales channel'),
      );
    }
    yield* Effect.try({
      try: () => SellAtChannelUC.run(channel),
      catch: () =>
        new CounterSaleRefused(
          'channelInactive',
          'A retired sales channel cannot take a sale',
        ),
    });

    const prices = yield* PublishedPriceReaderTag;
    const priced: CheckoutLineInput[] = [];
    for (const line of sale.lines) {
      const price = yield* prices.priceOf(line.offeringId);
      if (price === undefined) {
        return yield* Effect.fail(
          new CounterSaleRefused(
            'invalidBody',
            `nothing published answers to the offering "${line.offeringId}"`,
          ),
        );
      }
      // Here rather than at the reserve: by then this process has already
      // presented a token that can name any organization.
      if (price.vendorId !== organizationId) {
        return yield* Effect.fail(
          new CounterSaleRefused(
            'notYours',
            `The offering "${line.offeringId}" is not this organization's to sell`,
          ),
        );
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
    );

    switch (outcome._tag) {
      case 'completed':
        return { _tag: 'sold', result: outcome.result } as CounterSaleOutcome;
      case 'compensated':
        return { _tag: 'unavailable' } as CounterSaleOutcome;
      case 'failed':
        return yield* Effect.fail(
          new EntifixConnError(
            `the checkout coordinator answered ${outcome.status}`,
          ),
        );
    }
  });
