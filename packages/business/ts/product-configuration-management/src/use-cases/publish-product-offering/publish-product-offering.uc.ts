import { permissionForUseCase } from '@r10c/business-ts-authz';
import { useCase } from '@r10c/entifix-ts-core';

import { ProductOffering } from '../../entities/product-offering';
import { transitionOffering } from '../transition-offering';

/**
 * Put a vendor's offering in front of buyers.
 *
 * **`entity`-bound**: its subject is one record, and there is no bulk form of
 * it in v1 — publishing forty offerings at once means forty projections written
 * from forty different price snapshots, which is a decision to make with the
 * projection in front of you rather than a checkbox to inherit.
 *
 * **`context-independent`**, which puts it in the **form header** by
 * `ACTION_SURFACES`. Not `context-dependent` (the row overflow menu): a vendor
 * publishes the offering they have just read and priced, and a verb on a list
 * row publishes a record whose draft the operator has not seen. The cost is
 * recorded — there is no publish-from-the-list affordance yet.
 *
 * The confirmation is `neutral`: this is the act the screen exists for.
 */
@useCase({
  entity: ProductOffering,
  key: 'publish',
  binding: 'entity',
  placement: 'context-independent',
  // The same verb from the list, which is where a vendor with twenty drafts
  // actually works (#216). Three cells rather than three classes: a verb key is
  // the third segment of one permission, so three `@useCase()` declarations
  // would have been three permissions for one act — and a grant that let
  // somebody publish one offering but not twenty.
  alsoAt: [
    { binding: 'entity', placement: 'context-dependent' },
    { binding: 'collection', placement: 'context-dependent' },
  ],
  labelKey: 'entity:product-offering.useCases.publish',
  confirm: {
    tone: 'neutral',
    messageKey: 'entity:product-offering.useCases.publishConfirm',
  },
})
export class PublishProductOfferingUC {
  static run() {
    return transitionOffering;
  }
}

/**
 * The permission this use case derives. Import it; never retype the verb — the
 * source scan checks this against the grant table, which is the only other
 * place the string `publish` is written.
 */
export const PUBLISH_PRODUCT_OFFERING = permissionForUseCase(
  PublishProductOfferingUC,
);
