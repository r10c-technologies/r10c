'use client';

import { useT } from '@r10c/entifix-react-controls';
import {
  type CommandOption,
  type CommandSource,
  matchesCommand,
} from '@r10c/entifix-ts-core';
import { useMemo } from 'react';

import { useLocaleHref } from '../i18n';
import { useTabsState } from '../workspace/tabs-state';

/**
 * The workspace's open tabs, as one group.
 *
 * Read straight from the store rather than through a prop, because the palette
 * is mounted in the chrome and the tabs are the workspace's — there is no
 * component between them to thread it through.
 *
 * ⚠️ Outside `/workspace` the store is deliberately **unhydrated**
 * (`skipHydration: true`, rehydrated by `WorkspaceShell`), so this group is
 * empty there and the palette drops it. That is right rather than a limitation:
 * a tab is a thing you can return to inside the workspace, and offering one from
 * a plain route would navigate somewhere the person did not ask to be.
 *
 * Selecting one is a **deep link**, not a store call: `?tab=` is the tab's
 * address (ADR 0042), so the workspace focuses it on arrival and the palette
 * does not have to be inside the workspace tree to reach the store's actions.
 */
export function useTabsSource(term: string): CommandSource {
  const t = useT('shell');
  const withLocale = useLocaleHref();
  const tabs = useTabsState(state => state.tabs);

  return useMemo(() => {
    const options: CommandOption[] = tabs.map(tab => ({
      id: `tab:${tab.param}`,
      label: tab.title,
      href: withLocale(`/workspace?tab=${encodeURIComponent(tab.param)}`),
    }));

    return {
      key: 'tabs',
      groups: [
        {
          key: 'tabs',
          label: t('commandPalette.groups.tabs'),
          options: options.filter(option => matchesCommand(term, option)),
          isLoading: false,
        },
      ],
    } satisfies CommandSource;
  }, [tabs, term, t, withLocale]);
}
