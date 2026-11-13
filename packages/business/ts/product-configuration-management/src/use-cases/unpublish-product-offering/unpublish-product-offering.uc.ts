import { permissionForUseCase } from '@entifix/authz';
import { useCase } from '@entifix/core';
import { InvalidBody, SelectionTooLarge } from '@r10c/business-ts-common';

import { ProductOffering } from '../../entities/product-offering';
import { statusesBefore } from '../../values/offering-transition';
import { OfferingChanged } from '../offering-flows/offering-flows';
import {
  IllegalOfferingTransition,
  OfferingHasNoPrice,
  OfferingHasNoSpecification,
  transitionOffering,
} from '../transition-offering';

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
  // Offered only on what is up: taking down a draft is the one illegal move
  // a person can ask for, read off the transition table.
  availableWhen: { member: 'status', in: statusesBefore('unpublish') },
  alsoAt: [
    { binding: 'entity', placement: 'context-dependent' },
    { binding: 'collection', placement: 'context-dependent' },
  ],
  labelKey: 'entity:product-offering.useCases.unpublish',
  confirm: {
    tone: 'destructive',
    messageKey: 'entity:product-offering.useCases.unpublishConfirm',
  },
  // Publishing again puts the offering back where buyers find it, so
  // unpublishing acts at once and offers Undo (entifix ADR 0026).
  reversible: 'undo',
  inverse: 'publish',
  errors: [
    IllegalOfferingTransition,
    OfferingHasNoPrice,
    OfferingHasNoSpecification,
    OfferingChanged,
    InvalidBody,
    SelectionTooLarge,
  ],
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
