import { permissionForUseCase } from '@entifix/authz';
import { NotFound, useCase } from '@entifix/core';
import { InvalidBody } from '@r10c/business-ts-common';
import { FlowNotStarted } from '@r10c/business-ts-flow-contracts';
import { Effect, Schema } from 'effect';

import { SalesChannel } from '../../entities/sales-channel';
import {
  ChannelInactive,
  OfferingNotYours,
} from '../../failures/sales-failures';

/**
 * What a till sends: the goods and how the buyer paid. The channel is the
 * record the verb is bound to. **No price is read** — a price in the body
 * would be the one input that must never be the caller's.
 */
export const CounterSalePayload = Schema.Struct({
  lines: Schema.Array(
    Schema.Struct({
      offeringId: Schema.String.check(Schema.isMinLength(1)),
      quantity: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
    }),
  ).check(Schema.isMinLength(1)),
  /** Card or cash: what a counter takes. Cash on delivery is the storefront's. */
  paymentMethod: Schema.Literals(['card', 'cash']),
});

export type CounterSalePayload = typeof CounterSalePayload.Type;

/**
 * Take a sale through this channel.
 *
 * **A verb rather than a shape of `write`**, and the distinction is the whole
 * reason it exists. `ROLE_PERMISSIONS` states that no role holds
 * `order-management:product-order:write` "and none is coming": an order is
 * written by the checkout flow behind a crossing token, because holding a
 * vendor's stock is a crossing rather than an act a session performs. A counter
 * sale still has to be *authorized* to somebody, though — the member of staff
 * standing at the till — so the authority is named here, on the channel the
 * sale goes through, and sales-service checks it before presenting the
 * coordinator's token on their behalf
 * ([ADR 0056](../../../../../../docs/adr/0056-the-counter-sale-is-the-checkout-saga.md)).
 *
 * **`entity`-bound and `context-independent`**: its subject is one channel — the
 * counter somebody is standing at — and the affordance belongs in the form
 * header of that channel, beside the record it acts on. There is no bulk form
 * of selling.
 *
 * No `confirm`: the till's own payment step is the confirmation, and a dialog
 * in front of it would be a second one asking the same question.
 */
@useCase({
  entity: SalesChannel,
  key: 'sell',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:sales-channel.useCases.sell',
  // A retired channel's form offers no Sell; `run` below still refuses one,
  // because a page rendered before the retirement still shows the button.
  availableWhen: { member: 'status', in: ['active'] },
  recipe: 'checkout',
  payload: CounterSalePayload,
  errors: [
    NotFound,
    ChannelInactive,
    OfferingNotYours,
    InvalidBody,
    FlowNotStarted,
  ],
})
export class SellAtChannelUC {
  /**
   * The one rule this domain owns about starting a sale: a retired channel
   * takes none.
   *
   * ⚠️ **Refusing it here is not the same as hiding it in the UI.** A channel is
   * retired by a state change rather than a delete, because every order placed
   * through one keeps referring to it — so an `inactive` channel stays readable,
   * stays pickable by anything that does not check, and would keep taking sales
   * that the vendor believes are impossible.
   */
  static run(
    channel: SalesChannel,
  ): Effect.Effect<SalesChannel, ChannelInactive> {
    return channel.status === 'active'
      ? Effect.succeed(channel)
      : Effect.fail(new ChannelInactive({ channelId: String(channel.id) }));
  }
}

/**
 * The permission this use case derives. Import it; never retype the verb — the
 * source scan checks this against the grant table, which is the only other
 * place the string `sell` is written.
 */
export const SELL_AT_CHANNEL = permissionForUseCase(SellAtChannelUC);
