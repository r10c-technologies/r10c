'use client';

import {
  Sidebar,
  Tab,
  TabStrip,
  TopBar,
} from '@r10c/entifix-react-controls';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';

import { useDraftsStore } from './drafts-store';
import type { TabRegistry } from './tab-kind';
import { useTabsStore } from './tabs-store';

export interface WorkspaceShellProps {
  /** Resolves `?tab=` values to renderable tabs. */
  registry: TabRegistry;
  /** Sidebar navigation (a `SidebarNav`, say). */
  nav: ReactNode;
  /** Brand mark in the top bar. */
  brand: ReactNode;
  /** Right-aligned top-bar actions (search, the user menu). */
  actions?: ReactNode;
  /** Body when the URL addresses a tab kind that is not registered. */
  fallback?: ReactNode;
  /** Body when no tab is open. */
  emptyState?: ReactNode;
}

/**
 * The tab workspace: a top bar, a sidebar, and a strip of persisted tabs over
 * the active tab's body. The open set lives in {@link useTabsStore} (IndexedDB);
 * the URL's `?tab=` projects only the active tab, so a deep link opens or
 * focuses exactly that tab and an unknown kind shows the fallback instead of
 * crashing.
 */
export function WorkspaceShell({
  registry,
  nav,
  brand,
  actions,
  fallback,
  emptyState,
}: WorkspaceShellProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const urlTab = searchParams.get('tab');

  const tabs = useTabsStore(state => state.tabs);
  const activeParam = useTabsStore(state => state.activeParam);
  const open = useTabsStore(state => state.open);
  const close = useTabsStore(state => state.close);
  const activate = useTabsStore(state => state.activate);

  const drafts = useDraftsStore(state => state.drafts);
  const clearDraft = useDraftsStore(state => state.clearDraft);

  // Load the persisted tab set and drafts once, on the client (hydration is
  // skipped at creation so SSR never touches IndexedDB).
  useEffect(() => {
    void useTabsStore.persist.rehydrate();
    void useDraftsStore.persist.rehydrate();
  }, []);

  // A tab is dirty while its address has an unsaved draft; closing one confirms.
  const handleClose = (param: string) => {
    if (param in drafts) {
      if (!window.confirm('Discard unsaved changes in this tab?')) return;
      clearDraft(param);
    }
    close(param);
  };

  // Deep link → open/focus the addressed tab (ignored when the kind is unknown).
  useEffect(() => {
    if (!urlTab) return;
    const resolved = registry.resolve(urlTab);
    if (resolved) {
      open({ param: resolved.param, title: resolved.title });
    }
  }, [urlTab, registry, open]);

  // Project the active tab back to the URL so it stays shareable.
  useEffect(() => {
    if (activeParam && activeParam !== urlTab) {
      router.replace(`${pathname}?tab=${encodeURIComponent(activeParam)}`);
    }
  }, [activeParam, urlTab, pathname, router]);

  const activeResolved = activeParam ? registry.resolve(activeParam) : null;
  const body = activeResolved
    ? activeResolved.render()
    : urlTab && !registry.resolve(urlTab)
      ? fallback
      : emptyState;

  return (
    <Sidebar gap="none" className="min-h-screen">
      <Sidebar.Side
        as="aside"
        width="16rem"
        className="flex flex-col gap-m border-r border-border bg-surface-elevated p-s md:sticky md:top-0 md:h-screen md:overflow-y-auto"
      >
        <div className="px-2xs py-3xs text-step-1 font-semibold text-content">
          {brand}
        </div>
        {nav}
      </Sidebar.Side>

      <Sidebar.Main as="main" className="flex min-w-0 flex-col">
        <TopBar>
          <TopBar.Brand>{brand}</TopBar.Brand>
          {actions ? <TopBar.Actions>{actions}</TopBar.Actions> : null}
        </TopBar>

        <TabStrip>
          {tabs.map(tab => (
            <Tab
              key={tab.param}
              label={tab.title}
              active={tab.param === activeParam}
              state={tab.param in drafts ? 'dirty' : 'idle'}
              onSelect={() => activate(tab.param)}
              onClose={() => handleClose(tab.param)}
            />
          ))}
        </TabStrip>

        <div className="min-w-0 flex-1 p-m">{body}</div>
      </Sidebar.Main>
    </Sidebar>
  );
}
