'use client';

import { useT } from '@r10c/entifix-react-controls';
import { useCallback } from 'react';

import { useSessionRefresh } from './use-session-refresh';

export interface SessionKeepaliveProps {
  /** Where this app mounts the shared refresh handler. */
  readonly endpoint?: string;
  /**
   * What to do when the session is over. Defaults to reloading the page, which
   * is almost always the right answer — see the note on {@link
   * SessionKeepalive}.
   */
  readonly onExpired?: () => void;
}

/**
 * Mounts {@link useSessionRefresh} and acts on what it reports.
 *
 * ⚠️ **This component is why the hook does anything at all.** The hook shipped
 * with its schedule, its idle gate, its countdown and a full spec, and was
 * referenced by nothing — no app, no shell, no layout. So no browser in the
 * fleet ever posted to `/api/auth/refresh`, and three separately reasonable
 * facts combined into a bug (#252): the access token lives 15 minutes, both
 * cookies are sized to the seven-day session ceiling so that a cookie does not
 * sign everyone out every 15 minutes, and the middleware can only check that a
 * cookie is *present* because the edge cannot verify a signature. The visitor
 * was therefore admitted to pages that rendered fine while every call behind
 * them answered `401`.
 *
 * **Expiry reloads rather than routing anywhere**, and that is the smaller
 * change rather than the lazier one. By the time the hook reports `expired` the
 * refresh route has already cleared both cookies — a dead session clears them
 * instead of leaving the browser presenting a session id that will never
 * refresh again. A reload then meets the middleware with no cookie, and the
 * middleware redirects to sign-in with the right locale and the right
 * `redirect` parameter. Building that URL here would be a second copy of a rule
 * that already exists, and the two would drift the first time either changed.
 *
 * A form's unsaved work survives it, because a workspace draft is autosaved to
 * IndexedDB rather than held in the page
 * ([ADR 0032](../../../../../../docs/adr/0032-what-may-live-in-an-autosaved-draft.md)).
 *
 * Renders nothing but a warning strip, and only inside the final window before
 * the ceiling. `role="status"` rather than `role="alert"`: the session ending
 * soon is a thing to notice, not an error to interrupt for, and an assertive
 * live region would talk over whatever the person is actually doing.
 *
 * Neutral surface tokens rather than a warning colour, because the contract has
 * no warning colour — it carries `danger` and its subtle and content pair, and
 * nothing between that and the neutrals. Borrowing `danger` for "your session
 * ends in five minutes" would spend the one alarming colour on something that is
 * not an error; adding a semantic colour is a change to the token contract
 * ([ADR 0027](../../../../../../docs/adr/0027-two-scales-a-density-mode-and-the-type-system.md))
 * and does not belong in a session fix.
 */
export function SessionKeepalive({
  endpoint,
  onExpired,
}: SessionKeepaliveProps = {}) {
  // A reload rather than a route change: middleware is what knows where a
  // signed-out visitor goes, and `router.push` would keep the dead client-side
  // tree around while it got there.
  const expire = useCallback(() => {
    if (onExpired) {
      onExpired();
      return;
    }
    window.location.reload();
  }, [onExpired]);

  const { expiringSoon, expired } = useSessionRefresh({
    endpoint,
    onExpired: expire,
  });
  const t = useT('shell');

  if (expired || !expiringSoon) return null;

  return (
    <div
      role="status"
      data-testid="session-expiring"
      className="border-b border-border bg-surface-elevated px-s py-2xs text-step-sm text-content"
    >
      {t('session.expiringSoon')}
    </div>
  );
}
