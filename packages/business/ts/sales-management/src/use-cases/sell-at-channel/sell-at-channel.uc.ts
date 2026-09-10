import { permissionForUseCase } from '@r10c/business-ts-authz';
import { EntifixLogicError, useCase } from '@r10c/entifix-ts-core';

import { SalesChannel } from '../../entities/sales-channel';

/**
 * Take a sale through this channel.
 *
 * **A verb rather than a shape of `write`**, and the distinction is the whole
 * reason it exists. `ROLE_PERMISSIONS` states that no role holds
 * `order-management:product-order:write` "and none is coming": an order is
 * written by the checkout saga behind a crossing token, because holding a
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
  static run(channel: SalesChannel): SalesChannel {
    if (channel.status !== 'active') {
      throw new EntifixLogicError(
        'A retired sales channel cannot take a sale',
        undefined,
        { channelId: String(channel.id), status: channel.status },
      );
    }
    return channel;
  }
}

/**
 * The permission this use case derives. Import it; never retype the verb — the
 * source scan checks this against the grant table, which is the only other
 * place the string `sell` is written.
 */
export const SELL_AT_CHANNEL = permissionForUseCase(SellAtChannelUC);
