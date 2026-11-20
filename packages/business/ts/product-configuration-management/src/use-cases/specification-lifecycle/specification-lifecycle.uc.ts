import { permissionForUseCase } from '@entifix/authz';
import { NotFound, useCase } from '@entifix/core';
import { Effect } from 'effect';

import { ProductSpecification } from '../../entities/product-specification';
import {
  type SpecificationLifecycleStatus,
  type SpecificationMove,
  specificationStatusAfter,
  specificationStatusesBefore,
} from '../../values/specification-lifecycle';
import {
  SpecificationBeingRevised,
  SpecificationChanged,
  SpecificationNotTransitionable,
  SpecificationStillPinned,
} from './specification-failures';

/** The states a verb is offered in: those its move is legal from. */
const offeredFrom = (move: SpecificationMove) => ({
  member: 'lifecycleStatus',
  in: specificationStatusesBefore(move),
});

/** What a move decides: the state the version leaves, and the one it reaches. */
export interface SpecificationDecision {
  readonly from: SpecificationLifecycleStatus;
  readonly to: SpecificationLifecycleStatus;
}

/**
 * The one rule every verb applies: the move is legal from where the version
 * stands, or it is refused. The store then writes it conditional on `from`, so
 * a racing move that got there first wins and this one is refused there —
 * hiding the verb by `availableWhen` is presentation, this is the rule
 * (ADR 0079 §1).
 */
export const decideSpecificationMove = (
  specification: Pick<ProductSpecification, 'id' | 'lifecycleStatus'>,
  move: SpecificationMove,
): Effect.Effect<SpecificationDecision, SpecificationNotTransitionable> => {
  const from = specification.lifecycleStatus;
  const to = specificationStatusAfter(from, move);
  return from === undefined || to === undefined
    ? Effect.fail(
        new SpecificationNotTransitionable({
          id: String(specification.id),
          standing: String(from),
          move,
        }),
      )
    : Effect.succeed({ from, to });
};

/**
 * Freeze a version in design: it becomes the series' one `active` version, the
 * only kind an offering may be published on, and the version it replaces is
 * retired in the same write. Its content hash and `validFrom` are stamped.
 */
@useCase({
  entity: ProductSpecification,
  key: 'release',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:product-specification.useCases.release',
  availableWhen: offeredFrom('release'),
  emphasis: 'primary',
  // Neutral: it is the act the record is authored for, and nothing is lost —
  // but after it the content is frozen, and the dialog says so.
  confirm: {
    tone: 'neutral',
    messageKey: 'entity:product-specification.useCases.releaseConfirm',
  },
  errors: [NotFound, SpecificationNotTransitionable, SpecificationChanged],
})
export class ReleaseProductSpecificationUC {
  static run(
    specification: Pick<ProductSpecification, 'id' | 'lifecycleStatus'>,
  ) {
    return decideSpecificationMove(specification, 'release');
  }
}

/**
 * Open the next version of an active one, in design, as a copy of it. The
 * active version keeps selling until the new one is released; offerings stay
 * on the version they pin until a person moves them (ADR 0079 §2).
 */
@useCase({
  entity: ProductSpecification,
  key: 'revise',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:product-specification.useCases.revise',
  availableWhen: offeredFrom('revise'),
  errors: [NotFound, SpecificationNotTransitionable, SpecificationBeingRevised],
})
export class ReviseProductSpecificationUC {
  static run(
    specification: Pick<ProductSpecification, 'id' | 'lifecycleStatus'>,
  ) {
    return decideSpecificationMove(specification, 'revise');
  }
}

/**
 * Withdraw the active version without a successor: no new offering may pin
 * it, and the ones already pinned keep selling.
 */
@useCase({
  entity: ProductSpecification,
  key: 'retire',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:product-specification.useCases.retire',
  availableWhen: offeredFrom('retire'),
  // There is no un-retire: a retired version is reopened by revising it.
  confirm: {
    tone: 'destructive',
    messageKey: 'entity:product-specification.useCases.retireConfirm',
  },
  reversible: 'confirm',
  errors: [NotFound, SpecificationNotTransitionable, SpecificationChanged],
})
export class RetireProductSpecificationUC {
  static run(
    specification: Pick<ProductSpecification, 'id' | 'lifecycleStatus'>,
  ) {
    return decideSpecificationMove(specification, 'retire');
  }
}

/**
 * Mark a retired version as one nothing live sells. A person's verb (ADR 0079
 * open question 3, answered): refused while a published offering pins it. The
 * record is kept forever — orders name it.
 */
@useCase({
  entity: ProductSpecification,
  key: 'obsolete',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:product-specification.useCases.obsolete',
  availableWhen: offeredFrom('obsolete'),
  confirm: {
    tone: 'destructive',
    messageKey: 'entity:product-specification.useCases.obsoleteConfirm',
  },
  reversible: 'confirm',
  errors: [
    NotFound,
    SpecificationNotTransitionable,
    SpecificationStillPinned,
    SpecificationChanged,
  ],
})
export class ObsoleteProductSpecificationUC {
  static run(
    specification: Pick<ProductSpecification, 'id' | 'lifecycleStatus'>,
  ) {
    return decideSpecificationMove(specification, 'obsolete');
  }
}

export const RELEASE_PRODUCT_SPECIFICATION = permissionForUseCase(
  ReleaseProductSpecificationUC,
);
export const REVISE_PRODUCT_SPECIFICATION = permissionForUseCase(
  ReviseProductSpecificationUC,
);
export const RETIRE_PRODUCT_SPECIFICATION = permissionForUseCase(
  RetireProductSpecificationUC,
);
export const OBSOLETE_PRODUCT_SPECIFICATION = permissionForUseCase(
  ObsoleteProductSpecificationUC,
);
