import {
  emptyWizardState,
  withStepValue,
  type WizardDefinition,
  type WizardState,
} from '@r10c/entifix-ts-core';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useWizard } from './use-wizard.js';
import type { WizardDraftStore } from './use-wizard.types.js';

const productSetup: WizardDefinition = {
  key: 'product-setup',
  steps: [
    {
      id: 'start',
      kind: 'choice',
      labelKey: 'start',
      options: ['blank', 'duplicate'],
      to: ['identity', 'source'],
      next: state =>
        (state.steps.start as { option?: string } | undefined)?.option ===
        'duplicate'
          ? 'source'
          : 'identity',
    },
    { id: 'source', kind: 'selection', labelKey: 'source', to: ['identity'] },
    { id: 'identity', kind: 'form', labelKey: 'identity', to: ['summary'] },
    { id: 'summary', kind: 'summary', labelKey: 'summary', to: [] },
  ],
};

const store = (state?: WizardState) => ({
  state,
  save: vi.fn<(next: WizardState) => void>(),
  clear: vi.fn(),
}) satisfies WizardDraftStore;

describe('walking the flow', () => {
  it('starts at the entry step with the whole path projected', () => {
    const { result } = renderHook(() =>
      useWizard({ definition: productSetup }),
    );

    expect(result.current.activeStep).toBe('start');
    expect(result.current.steps.map(step => step.id)).toEqual([
      'start',
      'identity',
      'summary',
    ]);
    expect(result.current.canFinish).toBe(false);
  });

  it('re-projects the path once the branch point is answered', () => {
    const { result } = renderHook(() =>
      useWizard({ definition: productSetup }),
    );

    act(() =>
      result.current.setStepValue('start', {
        kind: 'choice',
        option: 'duplicate',
      }),
    );

    expect(result.current.steps.map(step => step.id)).toEqual([
      'start',
      'source',
      'identity',
      'summary',
    ]);
  });

  it('advances, goes back, and jumps to a visited step', () => {
    const { result } = renderHook(() =>
      useWizard({ definition: productSetup }),
    );

    act(() => result.current.next());
    expect(result.current.activeStep).toBe('identity');

    act(() => result.current.next());
    expect(result.current.activeStep).toBe('summary');
    expect(result.current.canFinish).toBe(true);

    act(() => result.current.previous());
    expect(result.current.activeStep).toBe('identity');

    act(() => result.current.goTo('start'));
    expect(result.current.activeStep).toBe('start');
    expect(result.current.state.history).toEqual([]);
  });

  it('starts over on reset', () => {
    const { result } = renderHook(() =>
      useWizard({ definition: productSetup }),
    );

    act(() =>
      result.current.setStepValue('start', { kind: 'choice', option: 'blank' }),
    );
    act(() => result.current.next());
    act(() => result.current.reset());

    expect(result.current.state).toEqual(emptyWizardState('start'));
  });

  it('reports where the operator went, so a shell can write the URL', () => {
    const onStepChange = vi.fn();
    const { result } = renderHook(() =>
      useWizard({ definition: productSetup, onStepChange }),
    );

    act(() => result.current.next());

    expect(onStepChange).toHaveBeenCalledExactlyOnceWith('identity');
  });

  it('says nothing when a move goes nowhere', () => {
    const onStepChange = vi.fn();
    const { result } = renderHook(() =>
      useWizard({ definition: productSetup, onStepChange }),
    );

    // Back at the entry step, and forward to a step never visited.
    act(() => result.current.previous());
    act(() => result.current.goTo('summary'));

    expect(onStepChange).not.toHaveBeenCalled();
    expect(result.current.activeStep).toBe('start');
  });

  it('overlays the errors the caller reports onto the stepper', () => {
    const { result } = renderHook(() =>
      useWizard({ definition: productSetup, errored: ['start'] }),
    );

    expect(result.current.steps[0]).toEqual({ id: 'start', status: 'error' });
  });
});

describe('the per-step draft store', () => {
  it('holds a step draft that survives leaving the step and coming back', () => {
    const { result } = renderHook(() =>
      useWizard({ definition: productSetup }),
    );

    act(() => result.current.draftStoreFor('identity').save({ name: 'Café' }));
    act(() => result.current.next());
    act(() => result.current.next());
    act(() => result.current.previous());

    expect(result.current.draftStoreFor('identity').draft).toEqual({
      name: 'Café',
    });
  });

  it('keeps `save` stable per step, so a render is not a write', () => {
    // `useEntityForm` writes from an effect keyed on `save`; a fresh identity
    // per render would turn every render into an IndexedDB write.
    const { result, rerender } = renderHook(() =>
      useWizard({ definition: productSetup }),
    );

    const first = result.current.draftStoreFor('identity').save;
    rerender();
    act(() => result.current.draftStoreFor('identity').save({ name: 'x' }));

    expect(result.current.draftStoreFor('identity').save).toBe(first);
  });

  it('omits `draft` entirely for a step nothing has answered', () => {
    // A fresh `{}` per call re-seeds the form on every render, which is the
    // `Maximum update depth exceeded` hang ADR 0038 measured.
    const { result, rerender } = renderHook(() =>
      useWizard({ definition: productSetup }),
    );

    expect(result.current.draftStoreFor('identity').draft).toBeUndefined();

    rerender();

    expect(result.current.draftStoreFor('identity').draft).toBeUndefined();
  });

  it('hands back the same draft reference while the step is unchanged', () => {
    const { result, rerender } = renderHook(() =>
      useWizard({ definition: productSetup }),
    );

    act(() => result.current.draftStoreFor('identity').save({ name: 'Café' }));
    const first = result.current.draftStoreFor('identity').draft;
    rerender();

    expect(result.current.draftStoreFor('identity').draft).toBe(first);
  });

  it('clears one step without touching the others', () => {
    const { result } = renderHook(() =>
      useWizard({ definition: productSetup }),
    );

    act(() => result.current.draftStoreFor('identity').save({ name: 'Café' }));
    act(() => result.current.draftStoreFor('summary').save({ note: 'ok' }));
    act(() => result.current.draftStoreFor('identity').clear());

    expect(result.current.draftStoreFor('identity').draft).toBeUndefined();
    expect(result.current.draftStoreFor('summary').draft).toEqual({
      note: 'ok',
    });
  });
});

describe('persistence', () => {
  it('writes the whole wizard on every answer', () => {
    const draft = store();
    const { result } = renderHook(() =>
      useWizard({ definition: productSetup, draft }),
    );

    act(() =>
      result.current.setStepValue('start', { kind: 'choice', option: 'blank' }),
    );

    expect(draft.save).toHaveBeenCalledOnce();
    expect(draft.save.mock.calls[0][0].steps.start).toEqual({
      kind: 'choice',
      option: 'blank',
    });
  });

  it('adopts a persisted wizard and flags the resume', () => {
    const mid = withStepValue(
      { activeStep: 'identity', history: ['start'], steps: {} },
      'start',
      { kind: 'choice', option: 'blank' },
    );
    const { result } = renderHook(() =>
      useWizard({ definition: productSetup, draft: store(mid) }),
    );

    expect(result.current.activeStep).toBe('identity');
    expect(result.current.isResumed).toBe(true);
  });

  it('does not call a wizard parked on its first step a resume', () => {
    // There is nothing to recap, so a banner would be noise.
    const { result } = renderHook(() =>
      useWizard({
        definition: productSetup,
        draft: store(emptyWizardState('start')),
      }),
    );

    expect(result.current.isResumed).toBe(false);
  });

  it('drops the resume banner the moment the operator moves on', () => {
    const mid: WizardState = {
      activeStep: 'identity',
      history: ['start'],
      steps: {},
    };
    const { result } = renderHook(() =>
      useWizard({ definition: productSetup, draft: store(mid) }),
    );

    act(() => result.current.next());

    expect(result.current.isResumed).toBe(false);
  });

  it('never lets a late hydration overwrite what was already typed', () => {
    // The store hydrates from an effect, so it can land after the operator has
    // started. Adopting it then would delete their first keystrokes.
    const draft = store();
    const { result, rerender } = renderHook(
      (props: { state?: WizardState }) =>
        useWizard({
          definition: productSetup,
          draft: { ...draft, state: props.state },
        }),
      { initialProps: {} as { state?: WizardState } },
    );

    act(() => result.current.draftStoreFor('identity').save({ name: 'Café' }));

    rerender({
      state: { activeStep: 'summary', history: ['start'], steps: {} },
    });

    expect(result.current.activeStep).toBe('start');
    expect(result.current.draftStoreFor('identity').draft).toEqual({
      name: 'Café',
    });
  });

  it('adopts only once, so a second hydration cannot rewind the flow', () => {
    const first: WizardState = {
      activeStep: 'identity',
      history: ['start'],
      steps: {},
    };
    const { result, rerender } = renderHook(
      (props: { state?: WizardState }) =>
        useWizard({
          definition: productSetup,
          draft: { save: vi.fn(), clear: vi.fn(), state: props.state },
        }),
      { initialProps: { state: first } },
    );

    act(() => result.current.next());
    rerender({ state: first });

    expect(result.current.activeStep).toBe('summary');
  });
});
