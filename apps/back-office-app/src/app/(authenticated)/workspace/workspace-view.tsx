'use client';

import { Menu, useT } from '@r10c/entifix-react-controls';
import {
  makeInMemoryReactiveChannel,
  useReactiveInvalidation,
} from '@r10c/entifix-react-integration';
import { WorkspaceShell } from '@r10c/shells-next-common';

import { workspaceRegistry } from './workspace-registry';

// Mock reactive channel until the WebSocket transport lands — the subscription
// seam is wired so a real socket drops in without touching the workspace.
const reactiveChannel = makeInMemoryReactiveChannel();

/**
 * The marketplace-admin tab workspace, wired to the catalog registry.
 * Sidebar navigation (including "open in workspace" links) comes from the
 * host `(authenticated)/layout.tsx` — this view is only the tab strip + body,
 * so there is exactly one, permission-filtered nav list instead of two.
 *
 * `scope` is resolved by the server page from the session; it keys the persisted
 * tabs and drafts so two accounts on one browser profile never share them.
 */
export function WorkspaceView({ scope }: { scope: string }) {
  const t = useT('app');
  const shellT = useT('shell');
  useReactiveInvalidation(reactiveChannel);

  return (
    <WorkspaceShell
      scope={scope}
      registry={workspaceRegistry}
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
