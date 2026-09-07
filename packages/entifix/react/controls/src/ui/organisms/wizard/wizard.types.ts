import type { WizardStepStatus } from '@r10c/entifix-ts-core';
import type { ReactNode } from 'react';

/**
 * One step as the stepper shows it.
 *
 * `label` is **already-resolved copy**, not a catalog key, which is the rule
 * `ConfirmDialog`'s `title`/`message` already follow: a step's name belongs to
 * the domain that declared the wizard, so its copy is `shell:`-namespaced and
 * this package cannot type-check the key.
 */
export interface WizardStepView {
  readonly id: string;
  readonly label: string;
  readonly status: WizardStepStatus;
}

export interface WizardProps {
  /**
   * The steps on the path this flow is taking, in order — the projection
   * `stepStatuses` returns, not the definition's whole step list.
   *
   * A graph's declared steps include branches not taken, so rendering all of
   * them promises an operator who chose to start blank a step they will never
   * see.
   */
  steps: readonly WizardStepView[];

  /** Which step's body `children` is. Controlled; the shell owns the URL. */
  activeStep: string;

  /**
   * The active step's heading.
   *
   * It is also the **focus target on advance**: moving focus to the top of the
   * new step is what makes a keyboard or screen-reader user land somewhere
   * meaningful instead of wherever the previous step's Next button was.
   */
  title: string;

  /** The active step's body. */
  children: ReactNode;

  onNext: () => void;
  onFinish: () => void;
  /** Absent at the entry step, where there is nowhere to go back to. */
  onPrevious?: () => void;
  /**
   * A completed step was clicked. Omit and the stepper is read-only.
   *
   * Only `complete` steps are clickable; a `pending` one would skip the per-step
   * submit that validates everything in between.
   */
  onStepChange?: (stepId: string) => void;

  /** The active step ends the flow, so the primary button reads Finalizar. */
  canFinish?: boolean;
  /** Advancing is blocked — a required answer is missing on this step. */
  canAdvance?: boolean;

  /**
   * The submit is in flight.
   *
   * It stays in flight: `onFinish` hands off and returns before the write is
   * terminal ([ADR 0043](../../../../../../../docs/adr/0043-the-optimistic-mutation-contract.md)),
   * so what this disables is a second submit — it is not a spinner waiting for
   * a resolution the caller never gets.
   */
  isSubmitting?: boolean;

  /**
   * What was already decided, shown when a half-finished wizard is resumed.
   *
   * Persistence gives "continue" for free; what it does not give is remembering
   * what you had answered, which is the known failure of a long flow restored
   * mid-way ([#111](https://github.com/r10c-technologies/r10c/issues/111)).
   */
  recap?: ReactNode;
  /** Dismiss the recap. Omit and it has no dismiss control. */
  onDismissRecap?: () => void;

  isLoading?: boolean;
  /**
   * What holds the wizard's shape while it is in flight.
   *
   * `true` (the default) renders the built-in placeholder, sized from the step
   * count it was given so the swap to the real stepper shifts nothing. A node
   * replaces that default; `false` renders no placeholder at all.
   */
  skeleton?: boolean | ReactNode;

  className?: string;
}
