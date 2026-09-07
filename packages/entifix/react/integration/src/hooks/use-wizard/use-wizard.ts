'use client';

import {
  advanceWizard,
  canFinish as canFinishWizard,
  emptyWizardState,
  type EntityDraft,
  entryStep,
  goBackWizard,
  goToWizardStep,
  stepStatuses,
  withStepValue,
  type WizardState,
  type WizardStepValue,
} from '@r10c/entifix-ts-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { EntityDraftStore } from '../use-entity-form/use-entity-form.types';
import type { UseWizardOptions, UseWizardResult } from './use-wizard.types';

/**
 * Drives one wizard: where the operator is, what they have answered, and the
 * per-step draft each form step edits.
 *
 * **The draft lives here, above the forms.** A form step calls `useEntityForm`
 * itself — React's hook count must stay fixed, so N form steps cannot be N hook
 * calls in one component — and it unmounts when it is not the active step. What
 * makes Back safe is therefore not keeping the step mounted but keeping its
 * values out of it: {@link UseWizardResult.draftStoreFor} hands the step an
 * `EntityDraftStore` viewing this state, and the step is free to come and go
 * ([ADR 0045](../../../../../../../docs/adr/0045-the-wizard-a-step-graph-and-a-submit-that-hands-off.md)).
 *
 * It holds no router and performs no submit. `onStepChange` reports where the
 * operator went so a shell can write the URL, and finishing is the host's — this
 * hook does not know a transaction exists.
 */
export function useWizard({
  definition,
  draft,
  errored,
  onStepChange,
}: UseWizardOptions): UseWizardResult {
  const entry = useMemo(() => entryStep(definition), [definition]);
  const [state, setState] = useState<WizardState>(() =>
    emptyWizardState(entry.id),
  );
  const [isResumed, setResumed] = useState(false);

  /**
   * The state as of the last commit, mirrored so a handler can read it without
   * a stale closure **and without doing its work inside a `setState` updater** —
   * an updater runs twice under StrictMode, which would fire `onStepChange`
   * and the persistence write twice per advance.
   */
  const stateRef = useRef(state);
  const touched = useRef(false);
  const adopted = useRef(false);

  const save = draft?.save;
  const persisted = draft?.state;

  const commit = useCallback(
    (updated: WizardState) => {
      const current = stateRef.current;
      if (updated === current) return;

      touched.current = true;
      stateRef.current = updated;
      setState(updated);
      save?.(updated);

      if (updated.activeStep !== current.activeStep) {
        // Resuming is a fact about arriving. Once the operator moves, the recap
        // has been read or ignored, and a banner that never leaves stops being
        // read at all.
        setResumed(false);
        onStepChange?.(updated.activeStep);
      }
    },
    [save, onStepChange],
  );

  const apply = useCallback(
    (next: (current: WizardState) => WizardState) =>
      commit(next(stateRef.current)),
    [commit],
  );

  /**
   * A persisted wizard is adopted **once, and only while untouched**.
   *
   * The store hydrates from an effect (`skipHydration`, ADR 0032), so it arrives
   * after the first render and cannot be a `useState` initializer. Adopting it
   * more than once would let a later hydration overwrite what the operator has
   * since typed, and adopting it after a first edit would do the same on the
   * very first keystroke.
   */
  useEffect(() => {
    if (adopted.current || touched.current || persisted === undefined) return;
    adopted.current = true;
    stateRef.current = persisted;
    setState(persisted);
    // Only a wizard that was genuinely mid-flow is a resume; one persisted on
    // its first step has nothing to recap.
    setResumed(persisted.history.length > 0);
  }, [persisted]);

  /**
   * One draft store per step id, minted once and kept forever.
   *
   * `useEntityForm` writes from an effect keyed on `save`, so a new identity per
   * render would make every render a write. A `Map` in a ref rather than a memo
   * because the set of steps a caller asks for grows as the flow is walked, and
   * a memo keyed on that set would rebuild every entry whenever one was added.
   */
  const stores = useRef(
    new Map<string, Pick<EntityDraftStore, 'save' | 'clear'>>(),
  );

  const draftStoreFor = useCallback(
    (stepId: string): EntityDraftStore => {
      let store = stores.current.get(stepId);
      if (store === undefined) {
        store = {
          save: (values: EntityDraft) =>
            apply(current =>
              withStepValue(current, stepId, { kind: 'form', values }),
            ),
          clear: () =>
            apply(current => withStepValue(current, stepId, { kind: 'none' })),
        };
        stores.current.set(stepId, store);
      }

      const value = state.steps[stepId];
      return {
        // The stored reference, and the key is **omitted** when the step holds
        // no draft — a fresh `{}` per render would re-seed the form every render,
        // which is the `Maximum update depth exceeded` hang ADR 0038 measured.
        ...(value?.kind === 'form' ? { draft: value.values } : {}),
        save: store.save,
        clear: store.clear,
      };
    },
    [apply, state],
  );

  return {
    state,
    activeStep: state.activeStep,
    steps: stepStatuses(definition, state, errored),
    canFinish: canFinishWizard(definition, state),
    isResumed,
    draftStoreFor,
    setStepValue: useCallback(
      (stepId: string, value: WizardStepValue) =>
        apply(current => withStepValue(current, stepId, value)),
      [apply],
    ),
    next: useCallback(
      () => apply(current => advanceWizard(definition, current)),
      [apply, definition],
    ),
    previous: useCallback(() => apply(goBackWizard), [apply]),
    goTo: useCallback(
      (stepId: string) => apply(current => goToWizardStep(current, stepId)),
      [apply],
    ),
    reset: useCallback(
      () => apply(() => emptyWizardState(entry.id)),
      [apply, entry],
    ),
  };
}
