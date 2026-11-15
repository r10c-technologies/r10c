'use client';

import { WorkspaceShell } from '@entifix/next-shell';
import { Alert, EmptyState, Menu, useT } from '@entifix/react-controls';
import { useMemo } from 'react';

import { workspaceRegistryFor } from './workspace-registry';

/**
 * The marketplace-admin tab workspace, wired to the catalog registry.
 * Sidebar navigation (including "open in workspace" links) comes from the
 * host `(authenticated)/layout.tsx` — this view is only the tab strip + body,
 * so there is exactly one, permission-filtered nav list instead of two.
 *
 * `scope` is resolved by the server page from the session; it keys the persisted
 * tabs and drafts so two accounts on one browser profile never share them.
 */
export function WorkspaceView({
  scope,
  partyRole,
}: {
  scope: string;
  /** Who is reading, for the tab captions only (#559, ADR 0015). */
  partyRole?: string;
}) {
  const t = useT('app');
  const shellT = useT('shell');
  const registry = useMemo(() => workspaceRegistryFor(partyRole), [partyRole]);

  return (
    <WorkspaceShell
      scope={scope}
      registry={registry}
      actions={
        <Menu>
          <Menu.Trigger>◍ {t('admin.menu.trigger')} ▾</Menu.Trigger>
          <Menu.Items>
            <Menu.Item>{t('admin.menu.preferences')}</Menu.Item>
            <Menu.Item>{t('admin.menu.signOut')}</Menu.Item>
          </Menu.Items>
        </Menu>
      }
      emptyState={<EmptyState>{shellT('workspace.empty')}</EmptyState>}
      fallback={<Alert tone="danger">{shellT('workspace.unsupported')}</Alert>}
    />
  );
}
