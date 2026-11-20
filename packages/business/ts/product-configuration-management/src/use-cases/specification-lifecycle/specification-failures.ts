import { Failure } from '@entifix/core';
import { Schema } from 'effect';

/**
 * The codes a route renders when a specification's lifecycle refuses — each
 * a key of the shared `errors` catalog, which `@r10c/i18n-check` holds every
 * one of them to.
 */
export const SPECIFICATION_NOT_TRANSITIONABLE =
  'specificationNotTransitionable';
export const SPECIFICATION_RELEASED = 'specificationReleased';
export const SPECIFICATION_BEING_REVISED = 'specificationBeingRevised';
export const SPECIFICATION_STILL_PINNED = 'specificationStillPinned';
export const SPECIFICATION_CHANGED = 'specificationChanged';

/** A version asked for a move its state does not allow. */
export class SpecificationNotTransitionable extends Failure.conflict<SpecificationNotTransitionable>()(
  'SpecificationNotTransitionable',
  SPECIFICATION_NOT_TRANSITIONABLE,
  { id: Schema.String, standing: Schema.String, move: Schema.String },
  {
    message: ({ standing, move }) =>
      `a specification version that is '${standing}' cannot ${move}`,
  },
) {}

/**
 * An edit or a delete aimed at a version that left `in-design`. ⚠️ The rule,
 * not a hidden button: a released version is never edited, and never deleted
 * because orders name it (ADR 0079 §1). The fix is `revise`.
 */
export class SpecificationReleased extends Failure.conflict<SpecificationReleased>()(
  'SpecificationReleased',
  SPECIFICATION_RELEASED,
  { id: Schema.String, standing: Schema.String },
  {
    message: ({ standing }) =>
      `this version is '${standing}' and frozen; revise it to change it`,
  },
) {}

/**
 * A revise while the series already has a version in design — one draft per
 * key, so two people never write two competing next versions.
 */
export class SpecificationBeingRevised extends Failure.conflict<SpecificationBeingRevised>()(
  'SpecificationBeingRevised',
  SPECIFICATION_BEING_REVISED,
  { specKey: Schema.String },
  {
    message: ({ specKey }) =>
      `'${specKey}' already has a version in design; finish or delete it first`,
  },
) {}

/**
 * Making a version obsolete while a published offering still sells it.
 * `obsolete` means nothing live pins it, so it is refused rather than
 * written as a claim that is false.
 */
export class SpecificationStillPinned extends Failure.conflict<SpecificationStillPinned>()(
  'SpecificationStillPinned',
  SPECIFICATION_STILL_PINNED,
  { id: Schema.String },
  {
    message: () =>
      'a published offering still sells this version; move or unpublish it first',
  },
) {}

/** Another move landed between this one's read and its write. */
export class SpecificationChanged extends Failure.conflict<SpecificationChanged>()(
  'SpecificationChanged',
  SPECIFICATION_CHANGED,
  { id: Schema.String },
  {
    message: () =>
      'another change to this specification landed first; reload it and try again',
  },
) {}
