import { EntifixBuildError } from '../base-entities/entifix-error';

/**
 * What a step holds, which decides how its value is stored and edited.
 *
 * `form` is one `useEntityForm` instance over part of an entity; `selection` is
 * a table step whose value is a set of ids; `choice` is a branch point offering
 * a fixed list of options; `summary` is the read-only recap; `custom` is
 * anything else the host renders and reads itself.
 */
export const WizardStepKinds = [
  'form',
  'selection',
  'choice',
  'summary',
  'custom',
] as const;
export type WizardStepKind = (typeof WizardStepKinds)[number];

/**
 * One step, and the edges out of it.
 *
 * **The graph is data; `next` only chooses along it.** `to` lists the steps this
 * one may lead to, so reachability, unknown targets, cycles and terminality are
 * decidable by reading the definition — no probing, no enumeration of the state
 * space, and no rule that "only appears to hold" because a `next` reading a form
 * value could never be enumerated. It is the move
 * [ADR 0039](../../../../../../docs/adr/0039-multi-step-sagas-are-orchestrated.md)
 * made for saga steps, for the same reason: a walkable definition is checkable
 * at load, and a function is not.
 *
 * A step with an empty `to` is **terminal**, and
 * {@link assertWizardDefinition} requires that to be the summary.
 */
export interface WizardStep {
  readonly id: string;
  readonly kind: WizardStepKind;
  /** Catalog key for the stepper's label. Resolved by the renderer, never here. */
  readonly labelKey: string;
  /**
   * The options a `choice` step offers, as stable identifiers.
   *
   * Required on `choice` and forbidden elsewhere: the value of a choice step is
   * one of these strings, so a choice with no options can never be answered and
   * options on a form step describe nothing.
   */
  readonly options?: readonly string[];
  /** Every step this one may lead to. Empty means the flow ends here. */
  readonly to: readonly string[];
  /**
   * Which of {@link WizardStep.to} comes next, given everything answered so far.
   *
   * Optional, and omitting it is the ordinary case: a step with exactly one edge
   * needs no function to pick it. A step with several **must** declare one, or
   * the definition cannot say where it goes.
   *
   * It returns a step id and never `undefined`: **the end of the flow is an
   * empty `to`, not a `next` that declines**. Two ways of saying the same thing
   * would let a step be terminal in one of them and not the other, and it is
   * `to` that {@link assertWizardDefinition} can read.
   */
  next?(state: WizardStateLike): string;
}

/**
 * The part of the state a `next` may read.
 *
 * Declared structurally rather than importing `WizardState`, so the definition
 * module stays below the state module and neither has to import the other.
 */
export interface WizardStateLike {
  readonly activeStep: string;
  readonly steps: { readonly [stepId: string]: unknown };
}

/**
 * A whole wizard: its key — which is also its screen key in a workspace address
 * — and its steps, the first of which is where the flow begins.
 */
export interface WizardDefinition {
  readonly key: string;
  readonly steps: readonly WizardStep[];
}

/** The step a flow starts at: the first declared. */
export const entryStep = (definition: WizardDefinition): WizardStep => {
  const [first] = definition.steps;
  if (first === undefined) {
    throw new EntifixBuildError(`wizard "${definition.key}" declares no steps`);
  }
  return first;
};

/** The step with this id, or `undefined` when the definition has none. */
export const findStep = (
  definition: WizardDefinition,
  stepId: string,
): WizardStep | undefined => definition.steps.find(step => step.id === stepId);

/**
 * Checks a definition the moment it is declared, and throws rather than
 * degrading.
 *
 * **Load time, not step time.** A wizard whose last step is missing, or whose
 * branch names a step that does not exist, must fail on the first render of any
 * surface rather than on the render of the step nobody reached — otherwise the
 * failure of the longest flow in the product arrives at the end of it. That is
 * the posture `assertLinkSourcesAreEditable` and `surfaceFor` already take
 * ([ADR 0035](../../../../../../docs/adr/0035-entity-actions-selection-and-bulk.md)).
 *
 * Six faults, each of which is silent otherwise:
 *
 * - **no steps**, which renders an empty frame with a disabled button;
 * - **a duplicate id**, which makes one step's stored value overwrite another's;
 * - **an unknown `to` target**, a typo that strands the flow mid-way;
 * - **several edges and no `next`**, which cannot say where the step goes;
 * - **a step nothing reaches**, which is either a dead branch or a missing edge;
 * - **the wrong terminal step** — the flow must end in the summary, and there
 *   must be exactly one of those. A wizard ending anywhere else commits without
 *   the operator ever seeing what they answered, which
 *   [#111](https://github.com/r10c-technologies/r10c/issues/111) records as not
 *   optional.
 *
 * A cycle needs no separate check: every step is reachable from the entry and
 * exactly one is terminal, so a cycle would leave the steps on it unable to
 * reach that terminal, which the walk below reports as unreachable-from-here.
 */
export function assertWizardDefinition(definition: WizardDefinition): void {
  const first = entryStep(definition);
  const ids = new Set<string>();

  for (const step of definition.steps) {
    if (ids.has(step.id)) {
      throw new EntifixBuildError(
        `wizard "${definition.key}" declares step "${step.id}" twice`,
      );
    }
    ids.add(step.id);
  }

  for (const step of definition.steps) {
    assertStepOptions(definition, step);

    for (const target of step.to) {
      if (!ids.has(target)) {
        throw new EntifixBuildError(
          `wizard "${definition.key}" step "${step.id}" leads to unknown step "${target}"`,
        );
      }
    }

    if (step.to.length > 1 && step.next === undefined) {
      throw new EntifixBuildError(
        `wizard "${definition.key}" step "${step.id}" has ${step.to.length} edges and no next()`,
      );
    }
  }

  assertOneSummaryAtTheEnd(definition);
  assertEveryStepIsReachable(definition, first);
}

/** `options` belongs to `choice` and to nothing else. */
function assertStepOptions(
  definition: WizardDefinition,
  step: WizardStep,
): void {
  if (step.kind === 'choice') {
    if (step.options === undefined || step.options.length === 0) {
      throw new EntifixBuildError(
        `wizard "${definition.key}" choice step "${step.id}" offers no options`,
      );
    }
    return;
  }
  if (step.options !== undefined) {
    throw new EntifixBuildError(
      `wizard "${definition.key}" step "${step.id}" is a ${step.kind} step and cannot declare options`,
    );
  }
}

/** Exactly one summary, and it is the only step the flow may end on. */
function assertOneSummaryAtTheEnd(definition: WizardDefinition): void {
  const summaries = definition.steps.filter(step => step.kind === 'summary');
  if (summaries.length !== 1) {
    throw new EntifixBuildError(
      `wizard "${definition.key}" declares ${summaries.length} summary steps, and must declare exactly one`,
    );
  }

  for (const step of definition.steps) {
    const terminal = step.to.length === 0;
    if (terminal && step.kind !== 'summary') {
      throw new EntifixBuildError(
        `wizard "${definition.key}" ends on "${step.id}", which is not its summary`,
      );
    }
    if (!terminal && step.kind === 'summary') {
      throw new EntifixBuildError(
        `wizard "${definition.key}" summary step "${step.id}" leads onward, and must end the flow`,
      );
    }
  }
}

/** Every declared step is on some path out of the entry step. */
function assertEveryStepIsReachable(
  definition: WizardDefinition,
  first: WizardStep,
): void {
  const seen = new Set<string>([first.id]);

  // A fixpoint over `seen` rather than a queue of resolved steps: every target
  // has already been checked to name a declared step, so a walk that looked one
  // up would carry an `undefined` arm nothing can reach — and an unreachable
  // arm is indistinguishable from an untested one.
  for (let grew = true; grew;) {
    grew = false;
    for (const step of definition.steps) {
      if (!seen.has(step.id)) continue;
      for (const target of step.to) {
        if (seen.has(target)) continue;
        seen.add(target);
        grew = true;
      }
    }
  }

  const stranded = definition.steps
    .filter(step => !seen.has(step.id))
    .map(step => step.id);

  if (stranded.length > 0) {
    throw new EntifixBuildError(
      `wizard "${definition.key}" cannot reach ${stranded.map(id => `"${id}"`).join(', ')} from "${first.id}"`,
    );
  }
}
