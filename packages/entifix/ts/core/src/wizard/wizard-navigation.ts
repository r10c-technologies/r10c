import { EntifixLogicError } from '../base-entities/entifix-error';
import { findStep, type WizardDefinition } from './wizard-definition';
import type { WizardState } from './wizard-state';

/** How a step reads in the stepper. */
export const WizardStepStatuses = [
  'pending',
  'active',
  'complete',
  'error',
] as const;
export type WizardStepStatus = (typeof WizardStepStatuses)[number];

/**
 * Where the active step leads, or `undefined` when it ends the flow.
 *
 * A step with one edge needs no `next`; a step with several declares one, and
 * what it returns **must** be an edge the step declared. That check is an
 * {@link EntifixLogicError} rather than a silent fallback because the two ways
 * of being wrong are both invisible otherwise: returning an id from another
 * branch strands the operator on a step whose earlier answers were never given,
 * and returning a typo would read as "this wizard has ended" one step early.
 */
export function nextStepId(
  definition: WizardDefinition,
  state: WizardState,
): string | undefined {
  const step = findStep(definition, state.activeStep);
  if (step === undefined || step.to.length === 0) return undefined;

  // `to` is non-empty here, so the fallback always resolves — which is why a
  // step ends a flow by declaring no edges rather than by returning nothing.
  const chosen = step.next?.(state) ?? step.to[0];

  if (!step.to.includes(chosen)) {
    throw new EntifixLogicError(
      `wizard "${definition.key}" step "${step.id}" chose "${chosen}", which is not one of its edges`,
    );
  }
  return chosen;
}

/**
 * The state one step further on, or the same state when there is nowhere to go.
 *
 * Unchanged rather than throwing on a terminal step: the button that calls this
 * is the one {@link canFinish} turns into Finalizar, so reaching here means the
 * caller asked twice, not that the definition is wrong.
 */
export function advanceWizard(
  definition: WizardDefinition,
  state: WizardState,
): WizardState {
  const next = nextStepId(definition, state);
  if (next === undefined) return state;

  return {
    ...state,
    activeStep: next,
    history: [...state.history, state.activeStep],
  };
}

/**
 * The state one step back, or the same state at the entry step.
 *
 * It pops {@link WizardState.history} rather than inverting `next`, which is the
 * whole reason that history is stored: a branch's inverse is ambiguous the
 * moment an earlier answer changes, so a computed one walks the operator back
 * through a path they were never on.
 */
export function goBackWizard(state: WizardState): WizardState {
  const previous = state.history.at(-1);
  if (previous === undefined) return state;

  return {
    ...state,
    activeStep: previous,
    history: state.history.slice(0, -1),
  };
}

/**
 * Jump to a step already visited.
 *
 * Backwards only, and to a step **on the current path** — a stepper may make a
 * completed step clickable, and nothing else. Jumping forward would skip the
 * per-step submit that validates the steps in between, which is the one thing
 * gating advancement at all; jumping to a step on an abandoned branch would put
 * the operator somewhere their current answers do not lead.
 *
 * The history truncates to before the target, exactly as arriving there by
 * pressing Back repeatedly would leave it.
 */
export function goToWizardStep(
  state: WizardState,
  stepId: string,
): WizardState {
  const index = state.history.indexOf(stepId);
  if (index === -1) return state;

  return {
    ...state,
    activeStep: stepId,
    history: state.history.slice(0, index),
  };
}

/** Whether the active step ends the flow, so its button reads Finalizar. */
export const canFinish = (
  definition: WizardDefinition,
  state: WizardState,
): boolean => nextStepId(definition, state) === undefined;

/**
 * The steps this flow runs through, given what has been answered — the ones
 * already visited, the active one, and the ones ahead.
 *
 * **Projected, not the declared list.** A graph's step list contains branches
 * not taken, so rendering `definition.steps` would show a stepper promising a
 * "duplicate" step to an operator who chose to start blank. Walking forward from
 * the active step with the current answers is what makes the stepper honest:
 * it re-shapes as a branch point is answered, which is the visible half of the
 * step graph being a graph.
 *
 * The walk stops on a step it has already placed, which is what makes it
 * terminate: every pass either adds a step to a finite set or stops. A
 * definition that cycles therefore produces a finite path rather than hanging
 * the render — `assertWizardDefinition` has already refused such a definition at
 * load, and this exists because a render loop is a worse way to find out.
 */
export function wizardPath(
  definition: WizardDefinition,
  state: WizardState,
): readonly string[] {
  const path = [...state.history, state.activeStep];
  const seen = new Set(path);

  let cursor = state.activeStep;
  for (;;) {
    const next = nextStepId(definition, { ...state, activeStep: cursor });
    if (next === undefined || seen.has(next)) break;
    path.push(next);
    seen.add(next);
    cursor = next;
  }

  return path;
}

/**
 * Each step on the projected path, with how it reads.
 *
 * `errored` is supplied by the caller rather than derived, because validity is
 * the step's own knowledge: a form step's errors live in its `useEntityForm`
 * instance, and this module is framework-free and holds none of them.
 *
 * An error wins over `complete` — a step the operator has been through and left
 * invalid is exactly the one the stepper has to point at.
 */
export function stepStatuses(
  definition: WizardDefinition,
  state: WizardState,
  errored: readonly string[] = [],
): ReadonlyArray<{ readonly id: string; readonly status: WizardStepStatus }> {
  const visited = new Set(state.history);

  return wizardPath(definition, state).map(id => ({
    id,
    status: statusOf(id, state.activeStep, visited, errored),
  }));
}

function statusOf(
  id: string,
  activeStep: string,
  visited: ReadonlySet<string>,
  errored: readonly string[],
): WizardStepStatus {
  if (errored.includes(id)) return 'error';
  if (id === activeStep) return 'active';
  return visited.has(id) ? 'complete' : 'pending';
}
