import { loadPrincipal } from '@r10c/shells-next-auth/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { BackOfficeChrome } from '../../lib/chrome';

/**
 * The account surface's gate — a session, and nothing more.
 *
 * Deliberately NOT the `(back-office)` layout, which additionally demands
 * `authn:user-identity:read`. Your own account is not an administrative screen:
 * a plain `user` has to be able to see their profile, reach the provider's
 * security settings and end their sessions. Sharing that layout would have
 * locked every non-admin out of their own account.
 */
export default async function AccountLayout({
  children,
}: {
  children: ReactNode;
}) {
  const principal = await loadPrincipal();
  if (principal === null) {
    redirect('/');
  }

  return (
    <BackOfficeChrome label={principal.subject}>{children}</BackOfficeChrome>
  );
}
