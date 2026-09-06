import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useViewportMode, viewportModeFor } from './use-viewport-mode';

type Listener = () => void;

/**
 * A `matchMedia` double that reports width, because jsdom's has no width at all
 * — it answers `false` to every query, which would make every mode read `rail`.
 */
const stubMatchMedia = (initialWidth: number) => {
  const listeners: Listener[] = [];
  const viewport = { width: initialWidth };
  const stub = vi.fn((query: string) => {
    const max = /max-width: (\d+)px/.exec(query);
    const min = /min-width: (\d+)px/.exec(query);
    return {
      // A getter, because a real `MediaQueryList` re-evaluates itself: the hook
      // holds one object and re-reads `matches` when it is told the viewport
      // changed. A frozen boolean here would make the hook look broken.
      get matches() {
        if (max !== null) return viewport.width <= Number(max[1]);
        return min !== null && viewport.width >= Number(min[1]);
      },
      addEventListener: (_: string, listener: Listener) =>
        listeners.push(listener),
      removeEventListener: vi.fn(),
    };
  });
  Object.defineProperty(window, 'matchMedia', {
    value: stub,
    configurable: true,
    writable: true,
  });
  return {
    listeners,
    resizeTo: (width: number) => {
      viewport.width = width;
    },
  };
};

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('viewportModeFor', () => {
  it('reads a phone as compact', () => {
    expect(viewportModeFor(400)).toBe('compact');
    expect(viewportModeFor(767)).toBe('compact');
  });

  it('reads a tablet as a rail', () => {
    expect(viewportModeFor(768)).toBe('rail');
    expect(viewportModeFor(1023)).toBe('rail');
  });

  it('reads a desktop as wide', () => {
    expect(viewportModeFor(1024)).toBe('wide');
  });
});

describe('useViewportMode', () => {
  it('resolves the mode after mount', () => {
    stubMatchMedia(500);
    const { result } = renderHook(() => useViewportMode());

    expect(result.current).toBe('compact');
  });

  it('reads a mid-width viewport as a rail', () => {
    stubMatchMedia(900);
    const { result } = renderHook(() => useViewportMode());

    expect(result.current).toBe('rail');
  });

  it('reads a wide viewport as wide', () => {
    stubMatchMedia(1400);
    const { result } = renderHook(() => useViewportMode());

    expect(result.current).toBe('wide');
  });

  it('follows a viewport that changes', () => {
    const { listeners, resizeTo } = stubMatchMedia(1400);
    const { result } = renderHook(() => useViewportMode());
    expect(result.current).toBe('wide');

    resizeTo(500);
    act(() => {
      for (const listener of listeners) listener();
    });

    expect(result.current).toBe('compact');
  });

  it('stays wide where matchMedia is not callable', () => {
    // Not hypothetical, and not a missing property either: jsdom *declares*
    // `matchMedia` and leaves it uncallable, so an `in` check passes and the
    // call throws inside a passive effect. Defaulting the other way would also
    // render a drawer on a desktop for one pass.
    Object.defineProperty(window, 'matchMedia', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const { result } = renderHook(() => useViewportMode());

    expect(result.current).toBe('wide');
  });
});
