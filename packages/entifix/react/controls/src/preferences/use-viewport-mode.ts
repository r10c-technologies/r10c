'use client';

import { useEffect, useState } from 'react';

/**
 * How much room the viewport has for chrome.
 *
 * - `compact` — under 768px. Navigation belongs behind a drawer; there is no
 *   room for a persistent rail beside the content.
 * - `rail` — 768px to 1024px. Enough for icons, not for labels.
 * - `wide` — 1024px and up. The stored preference decides.
 */
export type ViewportMode = 'compact' | 'rail' | 'wide';

const RAIL_MIN = 768;
const WIDE_MIN = 1024;

const modeFor = (width: number): ViewportMode => {
  if (width < RAIL_MIN) return 'compact';
  return width < WIDE_MIN ? 'rail' : 'wide';
};

/**
 * The viewport mode, as a media query the shell may branch on.
 *
 * ⚠️ This is the one place in the design system that asks about the viewport,
 * and it is deliberate. `docs/FRONTEND.md`'s no-media-query rule governs the
 * **layout primitives** in `ui/layout/`: they lay themselves out intrinsically
 * with `flex-wrap`/`flex-basis`/`gap`, and `Sidebar` still does. Choosing
 * between a drawer and a persistent rail is not laying out a box — it is picking
 * a navigation *mode*, and no amount of intrinsic sizing produces a focus trap.
 * See ADR 0041.
 *
 * It lives beside the UI preferences rather than in `ui/` because it belongs to
 * the same decision: what the viewport allows and what the person chose are the
 * two inputs to one answer, and only the second is a preference.
 *
 * Resolved in an effect, not during render, and defaulting to `wide`. The server
 * has no viewport, so any other default would render markup the first client
 * pass immediately contradicts — the same reason `useUiPreference` reads after
 * mount rather than during it.
 */
export function useViewportMode(): ViewportMode {
  const [mode, setMode] = useState<ViewportMode>('wide');

  useEffect(() => {
    // `typeof`, not `'matchMedia' in window`: jsdom declares the property and
    // leaves it uncallable, so the `in` check passes and the call then throws
    // inside a passive effect — which surfaces as a broken shell, not a missing
    // media query.
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    )
      return;

    const compact = window.matchMedia(`(max-width: ${RAIL_MIN - 1}px)`);
    const wide = window.matchMedia(`(min-width: ${WIDE_MIN}px)`);

    const sync = () => {
      setMode(compact.matches ? 'compact' : wide.matches ? 'wide' : 'rail');
    };

    sync();
    compact.addEventListener('change', sync);
    wide.addEventListener('change', sync);
    return () => {
      compact.removeEventListener('change', sync);
      wide.removeEventListener('change', sync);
    };
  }, []);

  return mode;
}

/** Exported for tests and for callers that already hold a width. */
export const viewportModeFor = modeFor;
