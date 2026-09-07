import type {
  WizardDefinition,
  WizardState,
  WizardStepStatus,
  WizardStepValue,
} from '@r10c/entifix-ts-core';

import type { EntityDraftStore } from '../use-entity-form/use-entity-form.types';

/**
 * Where a wizard's state is persisted, as the hook sees it.
 *
 * A **port**, and for exactly the reason `EntityDraftStore` is one: `useDraft`
 * and the zustand store behind it are `layer:shell`, this package is
 * `layer:entifix`, and `@nx/enforce-module-boundaries` fails the build on the
 * upward edge. `useWizardDraft` in `shells-next-common` is the one adapter.
 *
 * It is a second port rather than a reuse of `EntityDraftStore` because the two
 * carry different shapes — one holds an `EntityDraft`, this holds a whole
 * {@link WizardState} — and a single port widened to both would let a form be
 * handed a wizard's state by a caller that mixed them up.
 */
export interface WizardDraftStore {
  /** The persisted wizard, or `undefined` before anything was saved. */
  readonly state?: WizardState;
  /**
   * Persist the wizard. Called on every answered step.
   *
   * Must be referentially stable across renders, for the reason
   * `EntityDraftStore.save` must be: the write happens from an effect keyed on
   * it, and a fresh identity per render turns every render into a write.
   */
  save(state: WizardState): void;
  /**
   * Discard it.
   *
   * **The hook never calls this.** A wizard is spent when its submit is
   * *accepted*, and the hook does not know whether it was — it neither submits
   * nor watches the transaction. The host that owns the mutation calls it, the
   * same division `EntityDraftStore.clear` already draws.
   */
  clear(): void;
}

export interface UseWizardOptions {
  definition: WizardDefinition;
  /** Where to persist, so a half-finished flow survives a refresh. */
  draft?: WizardDraftStore;
  /**
   * Steps the caller knows are invalid, overlaid onto the stepper.
   *
   * Supplied rather than derived: a form step's validity lives in its own
   * `useEntityForm` instance, and this hook holds none of them.
   */
  errored?: readonly string[];
  /** Called whenever the active step changes, so a shell can write the URL. */
  onStepChange?: (stepId: string) => void;
}

export interface UseWizardResult {
  state: WizardState;
  activeStep: string;
  /** The steps on the projected path, with how each reads. */
  steps: ReadonlyArray<{
    readonly id: string;
    readonly status: WizardStepStatus;
  }>;
  /** The active step ends the flow. */
  canFinish: boolean;
  /**
   * A persisted wizard was picked up mid-flow, so the host owes a recap.
   *
   * True only until the operator moves — resuming is a fact about arriving, and
   * a banner that never goes away stops being read.
   */
  isResumed: boolean;

  /**
   * An `EntityDraftStore` viewing one form step's draft, to hand straight to
   * `useEntityForm`.
   *
   * ⚠️ Its `save` is **stable per step id** and its `draft` is the stored
   * reference, so a step that has not changed re-seeds nothing. Building either
   * fresh per render is the write-amplification `useEntityDraft` documents, and
   * a fresh `{}` for an unanswered step is worse — it re-seeds the form every
   * render, which is the `Maximum update depth exceeded` hang ADR 0038 measured.
   */
  draftStoreFor(stepId: string): EntityDraftStore;
  /** Record a non-form step's answer — a choice, a table selection. */
  setStepValue(stepId: string, value: WizardStepValue): void;

  next(): void;
  previous(): void;
  goTo(stepId: string): void;
  /** Start over, discarding every answer. The host clears the draft store. */
  reset(): void;
}
