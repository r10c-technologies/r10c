import type { ReactNode } from 'react';

import { BackOfficeChrome } from '../../lib/chrome';

/**
 * The chrome for every page that needs a session and nothing more — home, the
 * catalog, system management and the workspace. `/workspace` renders
 * `WorkspaceShell` inside it, which is only a tab strip + body (no sidebar or
 * top bar of its own), so nesting never doubles the chrome.
 *
 * The cookie check has already happened in middleware. Per-route authorization
 * is the services' job; what this group does not do is demand a back-office
 * permission, which is what separates it from `(back-office)`.
 */
export default function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <BackOfficeChrome>{children}</BackOfficeChrome>;
}
