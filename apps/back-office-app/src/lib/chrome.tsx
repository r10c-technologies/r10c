import { SCREEN_TYPE_LABEL_KEYS } from '@entifix/authz';
import {
  getRequestLocale,
  getServerT,
  getServerTranslateKey,
} from '@entifix/next-i18n/server';
import {
  AccountMenu,
  BackOfficeShell,
  SessionKeepalive,
} from '@entifix/next-shell';
// From the server entry: this module calls them directly, and the client entry
// would hand back a client reference rather than the function.
import { accountPaths } from '@entifix/next-shell/server';
import { OrganizationSwitcherButton } from '@r10c/shells-next-auth';
import type { ReactNode } from 'react';

import { BackOfficeCommandPalette } from './command-palette';
import { visibleCommands } from './commands';
import { navBreadcrumbLabels, sidebarNav } from './nav';
import { accessTokenExpiresIn, navPrincipal } from './nav-principal';

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
  const tokenExpiresInSeconds = await accessTokenExpiresIn();
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
    // Every segment a sidebar item names resolves from that item's own key, so
    // a crumb reads exactly as the sidebar does — and a shell contributing a
    // section gets translated crumbs without an entry here (#531).
    ...navBreadcrumbLabels(translateKey),
    // What follows names segments no sidebar item does, so it wins.
    home: t('admin.nav.dashboard'),
    // The Asistentes tier's own word, so a wizard's trail reads the way the
    // sidebar does. `SCREEN_TYPE_LABEL_KEYS` is the one place the four screen
    // types are named, and this resolves through it rather than restating it.
    wizards: translateKey(SCREEN_TYPE_LABEL_KEYS.wizard),
    // Generic on purpose: `/new` is every domain's create route, so a
    // domain-specific label here reads wrong on the other one's pages.
    new: translateKey('shell:breadcrumbs.new'),
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
        <>
          {/* Beside the account menu, and only for someone with two or more
              organizations to act for (#527). */}
          <OrganizationSwitcherButton />
          <AccountMenu
            label={label ?? translateKey('r10c:auth.account.menu')}
            items={accountPaths(locale)}
          />
        </>
      }
    >
      {/*
        Mounted once here rather than per route group, because all three need a
        session and only the permission they additionally demand differs. It
        renders nothing until the session is close to its ceiling; what it does
        unconditionally is keep the access token fresh, which nothing in this
        fleet did before (#252). Its first refresh is scheduled from the
        token this page rendered with, and every later one from the token the
        refresh mints, because the lifetime is a configuration row (#492).
      */}
      <SessionKeepalive
        {...(tokenExpiresInSeconds === undefined
          ? {}
          : { tokenExpiresInSeconds })}
      />
      {children}
    </BackOfficeShell>
  );
}
