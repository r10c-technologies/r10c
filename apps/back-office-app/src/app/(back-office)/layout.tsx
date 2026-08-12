import { can } from '@r10c/business-ts-authz';
import { loadPrincipal } from '@r10c/shells-next-auth/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { BackOfficeChrome } from '../../lib/chrome';

/**
 * The user-administration gate. It runs on the server, after middleware has
 * already bounced anyone without a cookie, and does the check that actually
 * matters here: resolve the principal from auth-service and refuse anyone the
 * policy does not grant user management. A plain `user` is sent to the
 * dashboard rather than shown an empty shell.
 *
 * Deliberately not in `middleware.ts`: verifying the token at the edge would
 * mean copying the signing key out of config-service into the Next runtime, and
 * this layout needs the principal anyway.
 *
 * Now that both domains share an origin, refusing sends the visitor to `/home`
 * on this host rather than across to another app.
 */
export default async function BackOfficeLayout({
  children,
}: {
  children: ReactNode;
}) {
  const principal = await loadPrincipal();
  if (principal === null) {
    redirect('/');
  }
  if (!can(principal.roles, 'authn:user-identity:read')) {
    redirect('/home');
  }

  return (
    <BackOfficeChrome label={principal.subject}>{children}</BackOfficeChrome>
  );
}
