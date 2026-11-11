import type { EntifixFailure } from '@entifix/core';

import { failedResponse } from './failed-response';

/** One session, or every session but the one in use. */
export type SessionTarget =
  | { readonly kind: 'one'; readonly sessionId: string }
  | { readonly kind: 'others' };

/** How a session verb ended: refused with a failure, or done. */
export type SessionVerbOutcome =
  | { readonly ok: false; readonly failure: EntifixFailure }
  | { readonly ok: true; readonly signedOut: boolean };

/**
 * Runs a session verb a screen's `useVerbInvoker` already confirmed, on this
 * origin's proxies of auth-service's derived routes: `sign-out-session` on a
 * `UserDevice` row, whose id is the session's, and the unbound
 * `sign-out-others`.
 *
 * The transport lives here, away from the screens, so a screen holds no write
 * of its own: every one of its verbs reaches this through the invoker, which
 * is where the confirmation is (ADR 0026), and `@r10c/conventions` refuses a
 * `fetch` in those screens outside their read loaders.
 */
export const runSessionVerb = async (
  key: string,
  target: SessionTarget,
): Promise<SessionVerbOutcome | undefined> => {
  const url =
    key === 'sign-out-session' && target.kind === 'one'
      ? `/api/user-device/${encodeURIComponent(target.sessionId)}/sign-out-session`
      : key === 'sign-out-others' && target.kind === 'others'
        ? '/api/auth/sessions'
        : undefined;
  if (url === undefined) return undefined;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) return { ok: false, failure: await failedResponse(res) };
  const body = (await res.json()) as { signedOut?: boolean };
  return { ok: true, signedOut: body.signedOut === true };
};
