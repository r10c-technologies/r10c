import { permissionForUseCase } from '@r10c/business-ts-authz';
import { useCase } from '@r10c/entifix-ts-core';

import { ProductOffering } from '../../entities/product-offering';
import { transitionOffering } from '../transition-offering';

/**
 * Take an offering off the storefront.
 *
 * The legible opposite of its sibling, and it carries the one genuinely illegal
 * move in the lifecycle: unpublishing something that was never published fails
 * rather than writing `unpublished` over a draft.
 *
 * `destructive`, although nothing is deleted here — the tone describes the
 * **consequence**, which is that the platform-plane record goes away and every
 * buyer's path to it with it. That is the same reading `retire` takes on the
 * shared vocabulary.
 */
@useCase({
  entity: ProductOffering,
  key: 'unpublish',
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
  labelKey: 'entity:product-offering.useCases.unpublish',
  confirm: {
    tone: 'destructive',
    messageKey: 'entity:product-offering.useCases.unpublishConfirm',
  },
})
export class UnpublishProductOfferingUC {
  static run() {
    return transitionOffering;
  }
}

/** The permission this use case derives. See the note on its sibling. */
export const UNPUBLISH_PRODUCT_OFFERING = permissionForUseCase(
  UnpublishProductOfferingUC,
);
