'use client';

import { Menu } from '@r10c/entifix-react-controls';
import { useState } from 'react';

export interface AccountMenuItem {
  /** Already-translated copy — the caller's server layout resolves the key. */
  readonly label: string;
  /**
   * Absolute for a cross-app destination, and it must already carry the locale:
   * `localeHref` deliberately leaves absolute URLs alone, so nothing downstream
   * will add the prefix for you.
   */
  readonly href: string;
}

export interface AccountMenuProps {
  /** Trigger text — typically the signed-in subject. */
  readonly label: string;
  readonly items: readonly AccountMenuItem[];
  readonly signOutLabel: string;
  /** Where this app mounts its logout handler. */
  readonly signOutEndpoint?: string;
  /** Fallback destination if logout answers without one. */
  readonly signOutRedirect?: string;
}

/**
 * The top-bar account menu.
 *
 * Entries are plain links because in every app but auth-app they cross an
 * origin. Copy arrives already translated, the same way `nav` labels do — this
 * is a client component, and the layouts that mount it have already resolved
 * the request's locale on the server.
 *
 * Showing or hiding an entry here protects nothing; auth-service refuses the
 * request. This is navigation, not authorization.
 */
export function AccountMenu({
  label,
  items,
  signOutLabel,
  signOutEndpoint = '/api/auth/logout',
  signOutRedirect = '/',
}: AccountMenuProps) {
  const [pending, setPending] = useState(false);

  const signOut = async () => {
    setPending(true);
    try {
      const response = await fetch(signOutEndpoint, {
        method: 'POST',
        cache: 'no-store',
      });
      const body = (await response.json()) as { redirect?: string };
      window.location.href = body.redirect ?? signOutRedirect;
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
            {item.label}
          </Menu.Link>
        ))}
        <Menu.Item onClick={signOut} disabled={pending}>
          {signOutLabel}
        </Menu.Item>
      </Menu.Items>
    </Menu>
  );
}
