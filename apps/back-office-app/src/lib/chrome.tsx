import { SCREEN_TYPE_LABEL_KEYS } from '@r10c/business-ts-authz';
import {
  AccountMenu,
  BackOfficeShell,
  SessionKeepalive,
} from '@r10c/shells-next-common';
// From the server entry: this module calls them directly, and the client entry
// would hand back a client reference rather than the function.
import { accountPaths } from '@r10c/shells-next-common/server';
import {
  getRequestLocale,
  getServerT,
  getServerTranslateKey,
} from '@r10c/shells-next-i18n/server';
import type { ReactNode } from 'react';

import { BackOfficeCommandPalette } from './command-palette';
import { visibleCommands } from './commands';
import { sidebarNav } from './nav';
import { navPrincipal } from './nav-principal';

/**
 * The back-office chrome, shared by all three route groups.
 *
 * There are three because they gate differently, not because they look
 * different: `(authenticated)` needs only a session, `(back-office)` also
 * demands `authn:user-identity:read`, and `(account)` deliberately demands
 * nothing beyond a session — your own account is not an administrative screen,
 * and a plain `user` has to reach it. Composing the shell once here is what
 * keeps that a difference in gates rather than three drifting copies of the
 * same layout.
 *
 * `accountPaths` rather than `accountUrls`: the account screens are served by
 * this host now, so the menu links to paths on this origin instead of across to
 * an app on another port.
 */
export async function BackOfficeChrome({
  children,
  label,
}: {
  children: ReactNode;
  /** Shown in the account menu. The principal's subject where one is loaded. */
  label?: string;
}) {
  const principal = await navPrincipal();
  const locale = await getRequestLocale();
  const t = await getServerT('app');
  // Nav labels are keys held in a route table, so they need the widened form.
  // Unbound: the table carries its own `app:` / `shell:` prefixes, because this
  // host renders copy owned by three different packages.
  const translateKey = await getServerTranslateKey();

  // Crumb labels are keyed by URL segment, which is a routing token — the shell
  // cannot know which namespace an app keeps its route names in, so the host
  // resolves them.
  const breadcrumbLabels: Record<string, string> = {
    home: t('admin.nav.dashboard'),
    // Owned by the shells that render these screens, so the keys carry their
    // namespace rather than living in this app's catalog.
    catalog: translateKey('shell:marketplaceAdmin.nav.catalog'),
    product: translateKey('shell:marketplaceAdmin.nav.products'),
    'product-brand': translateKey('shell:marketplaceAdmin.nav.brands'),
    'product-category': translateKey('shell:marketplaceAdmin.nav.categories'),
    'product-offering': translateKey('shell:marketplaceAdmin.nav.offerings'),
    'product-offering-price': translateKey(
      'shell:marketplaceAdmin.nav.offeringPrices',
    ),
    // The Asistentes tier's own word, so a wizard's trail reads the way the
    // sidebar does. `SCREEN_TYPE_LABEL_KEYS` is the one place the four screen
    // types are named, and this resolves through it rather than restating it.
    wizards: translateKey(SCREEN_TYPE_LABEL_KEYS.wizard),
    'product-setup': translateKey(
      'shell:marketplaceAdmin.wizard.productSetup.title',
    ),
    system: translateKey('shell:systemManagement.nav.section'),
    configuration: translateKey('shell:systemManagement.nav.configuration'),
    users: translateKey('shell:auth.nav.users'),
    // Generic on purpose: `/new` is every domain's create route, so a
    // domain-specific label here reads wrong on the other one's pages.
    new: translateKey('shell:breadcrumbs.new'),
    account: translateKey('shell:auth.account.title'),
    security: translateKey('shell:auth.security.title'),
    sessions: translateKey('shell:auth.sessions.title'),
  };

  const nav = sidebarNav(principal, translateKey);

  return (
    <BackOfficeShell
      nav={nav}
      brand={t('admin.brand')}
      breadcrumbLabels={breadcrumbLabels}
      commandPalette={
        <BackOfficeCommandPalette
          commands={visibleCommands(principal, translateKey)}
          nav={nav}
        />
      }
      accountMenu={
        <AccountMenu
          label={label ?? translateKey('shell:auth.account.menu')}
          items={accountPaths(locale)}
        />
      }
    >
      {/*
        Mounted once here rather than per route group, because all three need a
        session and only the permission they additionally demand differs. It
        renders nothing until the session is close to its ceiling; what it does
        unconditionally is keep the access token fresh, which nothing in this
        fleet did before (#252).
      */}
      <SessionKeepalive />
      {children}
    </BackOfficeShell>
  );
}
