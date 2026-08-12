'use client';

import {
  Tab,
  TabStrip,
  TopBar,
  useT,
  useTranslateKey,
} from '@r10c/entifix-react-controls';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';

import { useDraftsState } from './drafts-state';
import type { TabRegistry } from './tab-kind';
import { useTabsState } from './tabs-state';

export interface WorkspaceShellProps {
  /** Resolves `?tab=` values to renderable tabs. */
  registry: TabRegistry;
  /** Right-aligned actions above the tab strip (search, the user menu). */
  actions?: ReactNode;
  /** Body when the URL addresses a tab kind that is not registered. */
  fallback?: ReactNode;
  /** Body when no tab is open. */
  emptyState?: ReactNode;
}

/**
 * The tab workspace: a strip of persisted tabs over the active tab's body — no
 * sidebar or brand of its own. It is mounted inside a host shell (the
 * back-office layout, say) that already supplies those, so nesting two
 * sidebars never happens. The open set lives in {@link useTabsState}
 * (IndexedDB); the URL's `?tab=` projects only the active tab, so a deep link
 * opens or focuses exactly that tab and an unknown kind shows the fallback
 * instead of crashing.
 */
export function WorkspaceShell({
  registry,
  actions,
  fallback,
  emptyState,
}: WorkspaceShellProps) {
  const t = useT('shell');
  // Tab captions are catalog keys carried in a registry, not authored copy.
  const translate = useTranslateKey();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const urlTab = searchParams.get('tab');

  const tabs = useTabsState(state => state.tabs);
  const activeParam = useTabsState(state => state.activeParam);
  const open = useTabsState(state => state.open);
  const close = useTabsState(state => state.close);
  const activate = useTabsState(state => state.activate);

  const drafts = useDraftsState(state => state.drafts);
  const clearDraft = useDraftsState(state => state.clearDraft);

  // Load the persisted tab set and drafts once, on the client (hydration is
  // skipped at creation so SSR never touches IndexedDB).
  useEffect(() => {
    void useTabsState.persist.rehydrate();
    void useDraftsState.persist.rehydrate();
  }, []);

  // A tab is dirty while its address has an unsaved draft; closing one confirms.
  const handleClose = (param: string) => {
    if (param in drafts) {
      if (!window.confirm(t('workspace.discard'))) return;
      clearDraft(param);
    }
    close(param);
  };

  // Deep link → open/focus the addressed tab (ignored when the kind is unknown).
  useEffect(() => {
    if (!urlTab) return;
    const resolved = registry.resolve(urlTab, translate);
    if (resolved) {
      open({ param: resolved.param, title: resolved.title });
    }
  }, [urlTab, registry, open, translate]);

  // Project the active tab back to the URL so it stays shareable.
  //
  // The active tab is read from the *committed* store rather than from this
  // render's snapshot. Following a link to a second tab changes the URL one
  // commit before the store catches up, so the snapshot still names the
  // previously active tab — writing that back would undo the navigation, the
  // effect above would re-open the URL's tab, and the two would trade the
  // address bar back and forth forever (a visible flicker between, say, brands
  // and categories). The effect above runs first in the same commit, so by the
  // time this one reads the store the URL's tab is already active.
  useEffect(() => {
    const active = useTabsState.getState().activeParam;
    if (active && active !== urlTab) {
      router.replace(`${pathname}?tab=${encodeURIComponent(active)}`);
    }
  }, [activeParam, urlTab, pathname, router]);

  const copyDeepLink = (param: string) => {
    void navigator.clipboard.writeText(
      `${window.location.origin}${pathname}?tab=${encodeURIComponent(param)}`,
    );
  };

  const activeResolved = activeParam
    ? registry.resolve(activeParam, translate)
    : null;
  const body = activeResolved
    ? activeResolved.render()
    : urlTab && !registry.resolve(urlTab, translate)
      ? fallback
      : emptyState;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <TopBar>
        <TopBar.Actions>
          {activeParam && (
            <button
              type="button"
              onClick={() => copyDeepLink(activeParam)}
              className="rounded-md px-2xs py-3xs text-step-sm text-content-muted transition hover:bg-surface hover:text-content"
            >
              {t('workspace.copyLink')}
            </button>
          )}
          {actions}
        </TopBar.Actions>
      </TopBar>

      <TabStrip>
        {tabs.map(tab => (
          <Tab
            key={tab.param}
            // Re-derived from the registry rather than read back from the
            // store: the persisted title is whatever locale it was opened
            // in, so a locale switch would leave stale captions behind.
            label={registry.resolve(tab.param, translate)?.title ?? tab.title}
            active={tab.param === activeParam}
            state={tab.param in drafts ? 'dirty' : 'idle'}
            onSelect={() => activate(tab.param)}
            onClose={() => handleClose(tab.param)}
          />
        ))}
      </TabStrip>

      <div className="min-w-0 flex-1 p-m">{body}</div>
    </div>
  );
}
