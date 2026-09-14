import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useFollowWizardStepUrl,
  useWizardStepUrl,
  WIZARD_STEP_PARAM,
} from './use-wizard-step-param.js';

const push = vi.fn();
const replace = vi.fn();
let search = new URLSearchParams();

vi.mock('next/navigation', () => ({
  usePathname: () => '/es/wizards/product-setup',
  useRouter: () => ({ push, replace }),
  useSearchParams: () => search,
}));

const setUrl = (step?: string) => {
  search = new URLSearchParams(step === undefined ? '' : { step });
};

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  setUrl();
});

describe('useWizardStepUrl — writing the step into the address', () => {
  it('pushes the step the wizard moved to', () => {
    const { result } = renderHook(() => useWizardStepUrl());

    act(() => result.current('identity'));

    expect(push).toHaveBeenCalledExactlyOnceWith(
      '/es/wizards/product-setup?step=identity',
    );
  });

  it('keeps whatever else the address was carrying', () => {
    search = new URLSearchParams({ tab: 'master:product-specification' });
    const { result } = renderHook(() => useWizardStepUrl());

    act(() => result.current('identity'));

    expect(push).toHaveBeenCalledWith(
      '/es/wizards/product-setup?tab=master%3Aproduct-specification&step=identity',
    );
  });

  it('pushes nothing when the address already says that step', () => {
    // The guard that stops the loop: a Back drives `goTo`, which reports the
    // move, which would otherwise push the very address Back had just restored.
    setUrl('identity');
    const { result } = renderHook(() => useWizardStepUrl());

    act(() => result.current('identity'));

    expect(push).not.toHaveBeenCalled();
  });
});

describe('useFollowWizardStepUrl — following the address', () => {
  const follow = (activeStep: string, goTo: () => void) =>
    renderHook(
      (props: { activeStep: string }) =>
        useFollowWizardStepUrl({
          activeStep: props.activeStep,
          entryStep: 'start',
          goTo,
        }),
      { initialProps: { activeStep } },
    );

  it('moves the wizard when the address rewinds', () => {
    // Browser-Back: the address moves and the wizard follows it.
    setUrl('identity');
    const goTo = vi.fn();
    const { rerender } = follow('identity', goTo);

    setUrl('start');
    rerender({ activeStep: 'identity' });

    expect(goTo).toHaveBeenCalledExactlyOnceWith('start');
  });

  it('reads a rewind to an address with no step as the flow’s beginning', () => {
    // Where Back from the second step lands, since the first is never pushed.
    setUrl('identity');
    const goTo = vi.fn();
    const { rerender } = follow('identity', goTo);

    setUrl();
    rerender({ activeStep: 'identity' });

    expect(goTo).toHaveBeenCalledExactlyOnceWith('start');
  });

  it('does not move the wizard when the address is merely catching up', () => {
    // The ordinary advance: the wizard moved first and the writer pushed the
    // step it moved to. The address changed, but it now agrees.
    const goTo = vi.fn();
    const { rerender } = follow('start', goTo);

    setUrl('identity');
    rerender({ activeStep: 'identity' });

    expect(goTo).not.toHaveBeenCalled();
  });

  it('does nothing while the address agrees with the wizard', () => {
    setUrl('identity');
    const goTo = vi.fn();

    follow('identity', goTo);

    expect(goTo).not.toHaveBeenCalled();
  });

  it('leaves a resumed wizard where its draft put it', () => {
    // A restored flow opens on step four with an address that says nothing.
    // Acting on that address at mount would send it back to step one.
    const goTo = vi.fn();

    follow('classification', goTo);

    expect(goTo).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not move again for an address it has already followed', () => {
    setUrl('identity');
    const goTo = vi.fn();
    const { rerender } = follow('identity', goTo);

    setUrl('start');
    rerender({ activeStep: 'identity' });
    // The wizard has not caught up yet; the address has not moved again.
    rerender({ activeStep: 'identity' });

    expect(goTo).toHaveBeenCalledOnce();
  });

  it('writes nothing, ever', () => {
    // Rewriting the address to match the wizard races the advance: the replace
    // lands after it and puts the older step back, rewinding a step the
    // operator had already passed.
    setUrl('identity');
    const { rerender } = follow('summary', vi.fn());

    setUrl('start');
    rerender({ activeStep: 'summary' });

    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('the parameter name', () => {
  it('is stated once, so the reader and the writer cannot disagree', () => {
    expect(WIZARD_STEP_PARAM).toBe('step');
  });
});
