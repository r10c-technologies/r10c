import type { EntityDraft } from '../types/EntityDraft';

/**
 * What one step holds.
 *
 * A wizard's state is **heterogeneous by construction** — a form step drafts
 * strings, a table step holds a set of ids, a branch point holds the option
 * taken — so this is a discriminated union rather than one shape with optional
 * members, which would let a form step carry ids nothing would ever read.
 *
 * ⚠️ A selection holds `readonly string[]`, **never a `ReadonlySet`**. A `Set`
 * serializes to `{}` and does it silently, which is the fault
 * [ADR 0035](../../../../../../docs/adr/0035-entity-actions-selection-and-bulk.md)
 * named for the wire — and a wizard's state goes through `createJSONStorage` on
 * every keystroke, so it would be met far more often here than there.
 */
export type WizardStepValue =
  | { readonly kind: 'form'; readonly values: EntityDraft }
  | { readonly kind: 'selection'; readonly ids: readonly string[] }
  | { readonly kind: 'choice'; readonly option: string }
  | { readonly kind: 'none' };

/**
 * A wizard in progress: where the operator is, how they got there, and what
 * they have answered.
 *
 * **A `type`, never an `interface`.** This is persisted through
 * `createJSONStorage` and therefore has to satisfy `JsonValue`, and TypeScript
 * gives an interface no implicit index signature — the resulting "Index
 * signature for type 'string' is missing" explains nothing about the real cause
 * ([ADR 0032](../../../../../../docs/adr/0032-what-may-live-in-an-autosaved-draft.md)).
 *
 * `history` is **the path actually taken**, and it is what Back pops. A branch's
 * inverse is ambiguous once an earlier answer changes, so a computed `previous`
 * would walk the operator back through a path they were never on
 * ([ADR 0045](../../../../../../docs/adr/0045-the-wizard-a-step-graph-and-a-submit-that-hands-off.md)).
 *
 * `steps` is deliberately **not** pruned when a branch is abandoned. It is the
 * record of what was typed, and {@link wizardPath} decides what counts — so
 * flipping back to an earlier answer restores the work instead of discarding it,
 * while the summary and the submit still read only the steps on the live path.
 */
export type WizardState = {
  readonly activeStep: string;
  readonly history: readonly string[];
  readonly steps: { readonly [stepId: string]: WizardStepValue };
};

/** A wizard that has been opened and not yet answered. */
export const emptyWizardState = (entryStepId: string): WizardState => ({
  activeStep: entryStepId,
  history: [],
  steps: {},
});

/** The value stored for a step, or `undefined` when it has none. */
export const readStepValue = (
  state: WizardState,
  stepId: string,
): WizardStepValue | undefined => state.steps[stepId];

/**
 * The draft a form step holds, or an empty one.
 *
 * The fallback is `{}` rather than `undefined` for the reason every draft read
 * in this repo has one: a form handed `undefined` flips its inputs from
 * controlled to uncontrolled mid-render.
 */
export const readStepDraft = (
  state: WizardState,
  stepId: string,
): EntityDraft => {
  const value = state.steps[stepId];
  return value?.kind === 'form' ? value.values : {};
};

/** The ids a selection step holds, or none. */
export const readStepIds = (
  state: WizardState,
  stepId: string,
): readonly string[] => {
  const value = state.steps[stepId];
  return value?.kind === 'selection' ? value.ids : [];
};

/** The option a choice step holds, or `undefined` while it is unanswered. */
export const readStepChoice = (
  state: WizardState,
  stepId: string,
): string | undefined => {
  const value = state.steps[stepId];
  return value?.kind === 'choice' ? value.option : undefined;
};

/** The state with one step's value replaced. */
export const withStepValue = (
  state: WizardState,
  stepId: string,
  value: WizardStepValue,
): WizardState => ({
  ...state,
  steps: { ...state.steps, [stepId]: value },
});

/**
 * Narrows a restored value to a usable state.
 *
 * A persisted wizard comes back as `JsonValue`, so it can be anything — written
 * by a build before a step existed, `null`, or the right shape with the wrong
 * contents. Every caller must ask before reading, and the answer for a value
 * that fails is a **fresh** wizard rather than a crash: an unreadable draft is
 * an unfinished edit, and `restoreEntityDraft` already discards those per entry
 * rather than losing the whole form.
 *
 * A step value of an unknown `kind` fails the whole state rather than being
 * dropped, deliberately. Dropping it would resume the operator on a step whose
 * answer had silently vanished, which reads as the wizard having forgotten one
 * page of a flow it otherwise restored perfectly.
 */
export function readWizardState(value: unknown): WizardState | undefined {
  if (!isRecord(value)) return undefined;

  const { activeStep, history, steps } = value;
  if (typeof activeStep !== 'string' || activeStep === '') return undefined;
  if (!Array.isArray(history)) return undefined;
  if (!history.every(entry => typeof entry === 'string')) return undefined;
  if (!isRecord(steps)) return undefined;

  const readSteps: Record<string, WizardStepValue> = {};
  for (const [stepId, stepValue] of Object.entries(steps)) {
    const read = readStepValueOf(stepValue);
    if (read === undefined) return undefined;
    readSteps[stepId] = read;
  }

  return { activeStep, history, steps: readSteps };
}

function readStepValueOf(value: unknown): WizardStepValue | undefined {
  if (!isRecord(value)) return undefined;

  switch (value.kind) {
    case 'none':
      return { kind: 'none' };
    case 'choice':
      return typeof value.option === 'string'
        ? { kind: 'choice', option: value.option }
        : undefined;
    case 'selection':
      return Array.isArray(value.ids) &&
        value.ids.every(id => typeof id === 'string')
        ? { kind: 'selection', ids: value.ids }
        : undefined;
    case 'form':
      return isDraft(value.values)
        ? { kind: 'form', values: value.values }
        : undefined;
    default:
      return undefined;
  }
}

/**
 * Whether a restored value is a usable {@link EntityDraft}.
 *
 * The same two shapes `EntityDraft` allows, checked the way `isRowDraftArray`
 * checks its half — a scalar is a string and a composition is a list of row
 * drafts, and anything else means the entry was written by something that does
 * not know the contract.
 */
function isDraft(value: unknown): value is EntityDraft {
  return (
    isRecord(value) &&
    Object.values(value).every(
      member =>
        typeof member === 'string' ||
        (Array.isArray(member) && member.every(isRowOfStrings)),
    )
  );
}

const isRowOfStrings = (row: unknown): boolean =>
  isRecord(row) && Object.values(row).every(cell => typeof cell === 'string');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
