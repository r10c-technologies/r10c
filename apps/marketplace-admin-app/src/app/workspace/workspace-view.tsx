'use client';

import { Menu } from '@r10c/entifix-react-controls';
import {
  makeInMemoryReactiveChannel,
  useReactiveInvalidation,
} from '@r10c/entifix-react-integration';
import { WorkspaceShell } from '@r10c/shells-next-common';
import Link from 'next/link';

import { workspaceRegistry } from './workspace-registry';

// Mock reactive channel until the WebSocket transport lands — the subscription
// seam is wired so a real socket drops in without touching the workspace.
const reactiveChannel = makeInMemoryReactiveChannel();

const NAV: Array<{ label: string; param: string }> = [
  { label: 'Products', param: 'catalog:product' },
  { label: 'Brands', param: 'catalog:product-brand' },
  { label: 'Categories', param: 'catalog:product-category' },
];

/** The marketplace-admin tab workspace, wired to the catalog registry. */
export function WorkspaceView() {
  useReactiveInvalidation(reactiveChannel);

  return (
    <WorkspaceShell
      registry={workspaceRegistry}
      brand="r10c Admin"
      nav={
        <nav className="flex flex-col gap-3xs">
          {NAV.map(item => (
            <Link
              key={item.param}
              href={`/workspace?tab=${encodeURIComponent(item.param)}`}
              className="rounded-md px-2xs py-3xs text-step-sm text-content-muted transition hover:bg-surface hover:text-content"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      }
      actions={
        <Menu>
          <Menu.Trigger>◍ Admin ▾</Menu.Trigger>
          <Menu.Items>
            <Menu.Item>Preferences</Menu.Item>
            <Menu.Item>Sign out</Menu.Item>
          </Menu.Items>
        </Menu>
      }
      emptyState={
        <p className="text-content-muted">
          No open tabs. Pick a catalog from the sidebar to start.
        </p>
      }
      fallback={
        <p className="text-danger">This tab can’t be opened here.</p>
      }
    />
  );
}
