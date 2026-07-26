'use client';

import { Menu, useT } from '@r10c/entifix-react-controls';
import {
  makeInMemoryReactiveChannel,
  useReactiveInvalidation,
} from '@r10c/entifix-react-integration';
import { LocaleLink, WorkspaceShell } from '@r10c/shells-next-common';

import { workspaceRegistry } from './workspace-registry';

// Mock reactive channel until the WebSocket transport lands — the subscription
// seam is wired so a real socket drops in without touching the workspace.
const reactiveChannel = makeInMemoryReactiveChannel();

// Catalog keys, not copy — the workspace sidebar mirrors `lib/nav`, and two
// lists of rendered labels would drift the moment one is translated.
const NAV = [
  { labelKey: 'admin.nav.products', param: 'catalog:product' },
  { labelKey: 'admin.nav.brands', param: 'catalog:product-brand' },
  { labelKey: 'admin.nav.categories', param: 'catalog:product-category' },
] as const;

/** The marketplace-admin tab workspace, wired to the catalog registry. */
export function WorkspaceView() {
  const t = useT('app');
  const shellT = useT('shell');
  useReactiveInvalidation(reactiveChannel);

  return (
    <WorkspaceShell
      registry={workspaceRegistry}
      brand={t('admin.brand')}
      nav={
        <nav className="flex flex-col gap-3xs">
          {NAV.map(item => (
            <LocaleLink
              key={item.param}
              href={`/workspace?tab=${encodeURIComponent(item.param)}`}
              className="rounded-md px-2xs py-3xs text-step-sm text-content-muted transition hover:bg-surface hover:text-content"
            >
              {t(item.labelKey)}
            </LocaleLink>
          ))}
        </nav>
      }
      actions={
        <Menu>
          <Menu.Trigger>◍ {t('admin.menu.trigger')} ▾</Menu.Trigger>
          <Menu.Items>
            <Menu.Item>{t('admin.menu.preferences')}</Menu.Item>
            <Menu.Item>{t('admin.menu.signOut')}</Menu.Item>
          </Menu.Items>
        </Menu>
      }
      emptyState={
        <p className="text-content-muted">{shellT('workspace.empty')}</p>
      }
      fallback={
        <p className="text-danger">{shellT('workspace.unsupported')}</p>
      }
    />
  );
}
