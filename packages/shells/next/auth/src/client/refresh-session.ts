/**
 * Re-mints the access token from the session cookie, the way
 * `SessionKeepalive` does on its own schedule — for a caller that has to wait
 * for it, such as a push stream told to reauthenticate before it reopens
 * (ADR 0072).
 *
 * ⚠️ **Rejects on any non-2xx.** A stream that reopened after a failed refresh
 * would present the same expiring token and be closed again at once; rejecting
 * leaves it closed until the next change of interest instead.
 */
export const refreshSession = async (
  endpoint = '/api/auth/refresh',
): Promise<void> => {
  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw new Error(`session refresh answered ${String(response.status)}`);
  }
};
