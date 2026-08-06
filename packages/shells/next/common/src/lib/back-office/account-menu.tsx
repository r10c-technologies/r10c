'use client';

import { Menu, useT } from '@r10c/entifix-react-controls';
import { useState } from 'react';

import type { AccountLink } from '../session/account-links';

export interface AccountMenuProps {
  /** Trigger text — typically the signed-in subject. */
  readonly label: string;
  /**
   * Built by the host from `accountUrls()` / `accountPaths()`, which is where
   * the auth-app origin and the request's locale are known. Only the `href` is
   * the host's to supply; the copy is this component's own.
   */
  readonly items: readonly AccountLink[];
  /** Where this app mounts its logout handler. */
  readonly signOutEndpoint?: string;
  /** Fallback destination if logout answers without one. */
  readonly signOutRedirect?: string;
}

/**
 * The top-bar account menu.
 *
 * Entries are plain links because in every app but auth-app they cross an
 * origin. Unlike `nav`, whose labels are authored by the host app, this menu's
 * copy is authored here — so it is resolved here, out of `shell:account.*`,
 * and the host supplies only URLs.
 *
 * Showing or hiding an entry here protects nothing; auth-service refuses the
 * request. This is navigation, not authorization.
 */
export function AccountMenu({
  label,
  items,
  signOutEndpoint = '/api/auth/logout',
  signOutRedirect = '/',
}: AccountMenuProps) {
  const t = useT('shell');
  const [pending, setPending] = useState(false);

  const signOut = async () => {
    setPending(true);
    try {
      const response = await fetch(signOutEndpoint, {
        method: 'POST',
        cache: 'no-store',
      });
      const body = (await response.json()) as {
        redirect?: string;
        endSessionUrl?: string;
      };
      // The provider's end-session URL wins when the handler returns one.
      // Clearing our cookies alone leaves someone "signed out" who is one click
      // from being signed straight back in with no prompt, because the provider
      // still holds a session — which on a shared machine is the failure this
      // whole control exists to prevent.
      window.location.href =
        body.endSessionUrl ?? body.redirect ?? signOutRedirect;
    } catch {
      // The cookies may already be gone; get out of the protected area anyway.
      window.location.href = signOutRedirect;
    }
  };

  return (
    <Menu>
      <Menu.Trigger aria-label={label}>
        <span aria-hidden="true">◕</span>
        <span>{label}</span>
      </Menu.Trigger>
      <Menu.Items>
        {items.map(item => (
          <Menu.Link key={item.href} href={item.href}>
            {t(item.labelKey)}
          </Menu.Link>
        ))}
        <Menu.Item onClick={signOut} disabled={pending}>
          {t('account.signOut')}
        </Menu.Item>
      </Menu.Items>
    </Menu>
  );
}
