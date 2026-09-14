'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

/** The query parameter a wizard route carries its step in. */
export const WIZARD_STEP_PARAM = 'step';

/**
 * Builds this route's address with a step in it.
 *
 * Shared by the writer and the follower so the two cannot disagree about the
 * shape — and so neither drops the rest of the query, which on a workspace host
 * is the `?tab=` value naming the tab the wizard is inside.
 */
function useStepAddress(): (stepId: string) => string {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return useCallback(
    (stepId: string) => {
      const next = new URLSearchParams(searchParams);
      next.set(WIZARD_STEP_PARAM, stepId);
      return `${pathname}?${next.toString()}`;
    },
    [pathname, searchParams],
  );
}

/**
 * Writes a step into the address — what `useWizard`'s `onStepChange` is wired to.
 *
 * ⚠️ **This must be handed to `useWizard` directly, never through a ref.** The
 * push has to land in the same commit as the move: the follower below compares
 * the address with the active step, so a report that arrives a tick late leaves
 * the two disagreeing, and the follower reads that as a Back and moves the
 * wizard *back* to the step it just left. Splitting the writer from the follower
 * is what removes the cycle that made a ref look necessary.
 *
 * It **checks the address before pushing**, and that guard is what stops the
 * loop: a Back drives `goTo`, which reports the move, which would otherwise push
 * the very address Back had just restored — turning one press into an entry the
 * operator has to get past twice.
 */
export function useWizardStepUrl(): (stepId: string) => void {
  const router = useRouter();
  const searchParams = useSearchParams();
  const addressOf = useStepAddress();

  return useCallback(
    (stepId: string) => {
      if (searchParams.get(WIZARD_STEP_PARAM) === stepId) return;
      router.push(addressOf(stepId));
    },
    [router, searchParams, addressOf],
  );
}

export interface FollowWizardStepUrlOptions {
  /** Where the wizard currently is, from `useWizard`. */
  activeStep: string;
  /** The flow's first step — where an address carrying no step points. */
  entryStep: string;
  /**
   * `useWizard`'s `goTo`. It ignores a step that is not on the path already
   * walked, which is what makes browser-Forward safe to hand straight to it.
   */
  goTo: (stepId: string) => void;
}

/**
 * Moves the wizard when the address moves, so browser-Back moves a step instead
 * of leaving the flow.
 *
 * **Back works; Forward deliberately does not re-advance.** Going back pops the
 * history, so the step Forward names is no longer on the path and `goTo` ignores
 * it — re-entering it would skip the per-step submit that validated everything
 * in between, which is the only thing gating advancement.
 *
 * An address carrying **no** step means the flow's beginning — which is where
 * browser-Back from the second step lands, since the first step is never pushed.
 *
 * ⚠️ **It reacts to the address *changing*, never to what the address says.**
 * Two faults sit on either side of that, and both were measured:
 *
 * - *Rewriting the address to match the wizard* races the advance. The replace
 *   is scheduled at mount with the entry step captured, the operator advances
 *   before it lands, and the navigation then puts the older step back — this
 *   effect reads it and rewinds a step they had already passed. It appeared only
 *   under load, which is the kind of race that reaches a user and not a test.
 * - *Acting on the address at mount* breaks resume. A restored wizard takes its
 *   position from the persisted draft, so it opens on step four with an address
 *   that says nothing — read as "the beginning", that sends it back to step one
 *   and the resume is undone.
 *
 * So the first address seen is a **baseline**, and only a move away from it is a
 * navigation. One direction throughout: the writer owns the address, the
 * follower owns the wizard.
 */
export function useFollowWizardStepUrl({
  activeStep,
  entryStep,
  goTo,
}: FollowWizardStepUrlOptions): void {
  const searchParams = useSearchParams();
  const target = searchParams.get(WIZARD_STEP_PARAM) ?? entryStep;
  const seen = useRef(target);

  useEffect(() => {
    if (target === seen.current) return;
    seen.current = target;
    if (target !== activeStep) goTo(target);
  }, [target, activeStep, goTo]);
}
