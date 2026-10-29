import { permissionForUseCase } from '@entifix/authz';
import { useCase } from '@entifix/core';
import { InvalidBody } from '@r10c/business-ts-common';

import { ProductCategory } from '../../entities/product-category';
import { retireReferences } from '../retire-reference';

/**
 * Put a set of retired categorys back into circulation — the bulk bar's other
 * half of retiring. The same run, the other direction, and per row like it:
 * a row already active is reported rather than silently passed over.
 *
 * **`collection`-bound and `context-dependent`**, as retire is: its subject
 * is the rows ticked. No confirmation: nothing a restore does is lost by
 * retiring again.
 */
@useCase({
  entity: ProductCategory,
  key: 'restore',
  binding: 'collection',
  placement: 'context-dependent',
  labelKey: 'entity:product-category.useCases.restore',
  errors: [InvalidBody],
})
export class RestoreProductCategoryUC {
  static run() {
    return retireReferences;
  }
}

/**
 * The permission this use case derives. Import it; never retype the verb — the
 * source scan checks this against the grant table, which is the only other
 * place the string `restore` is written.
 */
export const RESTORE_PRODUCT_CATEGORY = permissionForUseCase(
  RestoreProductCategoryUC,
);
