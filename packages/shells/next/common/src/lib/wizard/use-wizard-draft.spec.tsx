import 'fake-indexeddb/auto';

import type { WizardState } from '@r10c/entifix-ts-core';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDraftsState } from '../workspace/drafts-state.js';
import { useWizardDraft } from './use-wizard-draft.js';

const ADDRESS = 'wizard:product-setup';

const midFlow: WizardState = {
  activeStep: 'identity',
  history: ['start'],
  steps: {
    start: { kind: 'choice', option: 'blank' },
    identity: { kind: 'form', values: { name: 'Café' } },
  },
};

beforeEach(() => {
  useDraftsState.setState({ drafts: {} });
  vi.spyOn(useDraftsState.persist, 'rehydrate').mockResolvedValue(undefined);
});

afterEach(() => {
  useDraftsState.setState({ drafts: {} });
});

describe('useWizardDraft', () => {
  it('reads the wizard stored at its address', () => {
    useDraftsState.getState().setDraft(ADDRESS, midFlow);

    const { result } = renderHook(() => useWizardDraft(ADDRESS));

    expect(result.current.state).toEqual(midFlow);
  });

  it('has no state before anything was saved', () => {
    const { result } = renderHook(() => useWizardDraft(ADDRESS));

    expect(result.current.state).toBeUndefined();
  });

  it('persists and clears through the workspace store', async () => {
    const { result } = renderHook(() => useWizardDraft(ADDRESS));

    await act(async () => result.current.save(midFlow));
    expect(useDraftsState.getState().drafts[ADDRESS]).toEqual(midFlow);

    await act(async () => result.current.clear());
    expect(useDraftsState.getState().drafts[ADDRESS]).toBeUndefined();
  });

  it('answers with nothing for a stored value that no longer parses', () => {
    // A wizard written by an older build resumes as a fresh one rather than
    // crashing — and the whole state goes, not one step, because resuming with
    // a page silently forgotten is worse than starting over.
    useDraftsState.getState().setDraft(ADDRESS, {
      activeStep: 'identity',
      history: ['start'],
      steps: { start: { kind: 'from-a-previous-life' } },
    });

    const { result } = renderHook(() => useWizardDraft(ADDRESS));

    expect(result.current.state).toBeUndefined();
  });

  it('keeps a stable identity while nothing changes, so a render is not a write', () => {
    useDraftsState.getState().setDraft(ADDRESS, midFlow);

    const { result, rerender } = renderHook(() => useWizardDraft(ADDRESS));
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
    expect(result.current.save).toBe(first.save);
  });

  it('keeps two wizards at two addresses apart', () => {
    useDraftsState.getState().setDraft(ADDRESS, midFlow);

    const { result } = renderHook(() => useWizardDraft('wizard:other'));

    expect(result.current.state).toBeUndefined();
  });
});
