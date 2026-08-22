'use client';

import {
  Tab,
  TabStrip,
  TopBar,
  useT,
  useTranslateKey,
} from '@r10c/entifix-react-controls';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';

import { useDraftsState } from './drafts-state';
import type { TabRegistry } from './tab-kind';
import { useTabsState } from './tabs-state';

export interface WorkspaceShellProps {
  /** Resolves `?tab=` values to renderable tabs. */
  registry: TabRegistry;
  /** Right-aligned actions above the tab strip (search, the user menu). */
  actions?: ReactNode;
  /** Body when `?tab=` names something the registry cannot resolve. */
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
  //
  // Both URL effects below wait on this flag, because the read is async and
  // lands *after* the first commit: opening the deep-linked tab before it
  // resolves means the restored snapshot's `activeParam` overwrites the tab the
  // URL asked for, and the write-back then projects that wrong tab into the
  // address bar. The URL is the more specific instruction, so it is applied
  // once the store has finished restoring rather than before.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    void Promise.all([
      useTabsState.persist.rehydrate(),
      useDraftsState.persist.rehydrate(),
    ]).finally(() => setHydrated(true));
  }, []);

  // The `?tab=` value the registry cannot resolve, if any — derived, so it is
  // known on the very first render rather than an effect later. An
  // unresolvable address used to be dropped on the floor: no tab, no error,
  // and the write-back below then replaced it with the previously active tab,
  // so even the URL stopped saying what was asked for. Here it answers with
  // the fallback and the bad address stays in the bar, where it can be read.
  //
  // `dismissed` is the escape: a deliberate tab interaction is a newer
  // instruction than the address that failed, and it holds the *value* rather
  // than a flag so the next dead link is dead again.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const deadLink =
    urlTab && urlTab !== dismissed && !registry.resolve(urlTab, translate)
      ? urlTab
      : null;

  // A tab is dirty while its address has an unsaved draft; closing one confirms.
  const handleClose = (param: string) => {
    if (param in drafts) {
      if (!window.confirm(t('workspace.discard'))) return;
      clearDraft(param);
    }
    setDismissed(urlTab);
    close(param);
  };

  const handleActivate = (param: string) => {
    setDismissed(urlTab);
    activate(param);
  };

  // Deep link → open/focus the addressed tab (a dead one shows the fallback).
  useEffect(() => {
    if (!hydrated || !urlTab) return;
    const resolved = registry.resolve(urlTab, translate);
    if (resolved) {
      open({ param: resolved.param, title: resolved.title });
    }
  }, [hydrated, urlTab, registry, open, translate]);

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
  // That ordering is also what makes the `hydrated` gate work: when the flag
  // flips, the effect above has already re-applied the URL's tab over the
  // restored snapshot, so there is nothing here to write back.
  //
  // A dead deep link suspends it: overwriting the address the visitor typed
  // with an unrelated tab is what made the failure invisible in the first place.
  useEffect(() => {
    if (!hydrated || deadLink) return;
    const active = useTabsState.getState().activeParam;
    if (active && active !== urlTab) {
      router.replace(`${pathname}?tab=${encodeURIComponent(active)}`);
    }
  }, [hydrated, deadLink, activeParam, urlTab, pathname, router]);

  const copyDeepLink = (param: string) => {
    void navigator.clipboard.writeText(
      `${window.location.origin}${pathname}?tab=${encodeURIComponent(param)}`,
    );
  };

  const activeResolved = activeParam
    ? registry.resolve(activeParam, translate)
    : null;
  const body = deadLink
    ? fallback
    : activeResolved
      ? activeResolved.render()
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
            // Nothing is selected while the fallback is up: a highlighted
            // tab beside a body that is not its own reads as a render bug.
            active={!deadLink && tab.param === activeParam}
            state={tab.param in drafts ? 'dirty' : 'idle'}
            onSelect={() => handleActivate(tab.param)}
            onClose={() => handleClose(tab.param)}
          />
        ))}
      </TabStrip>

      <div className="min-w-0 flex-1 p-m">{body}</div>
    </div>
  );
}
