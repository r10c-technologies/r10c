import { permissionForUseCase } from '@r10c/business-ts-authz';
import { useCase } from '@r10c/entifix-ts-core';

import { ProductBrand } from '../../entities/product-brand';
import { retireReferences } from '../retire-reference';

/**
 * Take a set of brands out of circulation — the marketplace has stopped
 * carrying them, but the offerings already classified under them must keep
 * resolving.
 *
 * **`collection`-bound**, which is what makes it the bulk bar's rather than a
 * form's: its subject is a *set*. That distinction is not cosmetic — an
 * entity-bound verb fanned out client-side would issue one request per row, and
 * the "select all 3.200 matching" case has no id list to fan out over in the
 * first place.
 *
 * **`context-dependent`**, because it needs something selected before it means
 * anything. A `context-independent` collection verb sits in the toolbar and
 * acts on the whole collection; retiring the entire brand vocabulary in one
 * click is not an affordance anybody wants.
 *
 * The confirmation is `destructive` even though nothing is deleted: what the
 * tone describes is the *consequence* — every picker across the marketplace
 * stops offering these brands — not the storage operation.
 */
@useCase({
  entity: ProductBrand,
  key: 'retire',
  binding: 'collection',
  placement: 'context-dependent',
  labelKey: 'entity:product-brand.useCases.retire',
  confirm: {
    tone: 'destructive',
    messageKey: 'entity:product-brand.useCases.retireConfirm',
  },
})
export class RetireProductBrandUC {
  static run() {
    return retireReferences;
  }
}

/**
 * The permission this use case derives. Import it; never retype the verb — the
 * source scan checks this against the grant table, which is the only other
 * place the string `retire` is written.
 */
export const RETIRE_PRODUCT_BRAND = permissionForUseCase(RetireProductBrandUC);
