'use client';

// Installs r10c's catalogs into the i18next binding. Importing is the act.
import '@r10c/i18n-catalog';

import type { Locale } from '@entifix/core';
import {
  ANONYMOUS_WORKSPACE_SCOPE,
  PendingFlowsProvider,
} from '@entifix/next-shell';
import {
  makeIndexedDbUiPreferencesState,
  type ThemeOption,
  type ThemePalette,
  ThemeProvider,
  ToastProvider,
  ToastRegion,
  UiPreferencesProvider,
  useT,
} from '@entifix/react-controls';
import { I18nProvider } from '@entifix/react-controls/i18next';
import {
  EntifixQueryProvider,
  type PushTopic,
  useReactiveCache,
} from '@entifix/react-integration';
import { makeEventSourcePushChannel } from '@entifix/react-integration/event-source';
import { buildFlowStatusReader } from '@entifix/rest';
import { refreshSession } from '@r10c/shells-next-auth';
import {
  FULFILMENT_PUSH_TOPICS,
  FulfilmentProvider,
} from '@r10c/shells-next-fulfilment';
import {
  CATALOG_PUSH_TOPICS,
  createClientAdapters,
  MarketplaceAdminAdaptersProvider,
} from '@r10c/shells-next-marketplace-admin';
import { ORDER_PUSH_TOPICS, OrderProvider } from '@r10c/shells-next-order';
import { SalesProvider } from '@r10c/shells-next-sales';
import { SettlementProvider } from '@r10c/shells-next-settlement';
import { StockProvider } from '@r10c/shells-next-stock';
import { SystemManagementProvider } from '@r10c/shells-next-system-management';
import { type PropsWithChildren, useMemo } from 'react';

const RUNTIME_PALETTES: Record<string, ThemePalette> = {
  ocean: {
    surface: '#eef6f7',
    'surface-elevated': '#ffffff',
    content: '#0d2b30',
    'content-muted': '#4a6b70',
    primary: '#0e8a8f',
    'primary-content': '#ffffff',
    border: '#cbe4e6',
    accent: '#0f6f8c',
  },
};

// One IndexedDB-backed preferences store for the app lifetime — module-level so
// its identity is stable across renders (a fresh store each render would reopen
// the database). Unifies all persisted client UI state in IndexedDB alongside
// the tab workspace, replacing the localStorage backend.
const uiPreferencesStore = makeIndexedDbUiPreferencesState();

/**
 * The tab's one push stream (ADR 0072), through the edge at
 * `/api/realtime/stream` — never through Next, which cannot hold a stream
 * open. Module-level for the same reason as the store above: one
 * `EventSource` per tab, opened only once something subscribes. A stream told
 * to reauthenticate is reopened after the session refresh resolves.
 */
const pushChannel = makeEventSourcePushChannel({
  url: '/api/realtime/stream',
  refresh: refreshSession,
});

/** A pending flow's catch-up, from the `status` link its `202` carried. */
const readFlowStatus = buildFlowStatusReader();

/** Every entity a back-office screen can be pushed about, from each shell. */
const PUSHED_TOPICS: readonly PushTopic[] = [
  ...CATALOG_PUSH_TOPICS,
  ...ORDER_PUSH_TOPICS,
  ...FULFILMENT_PUSH_TOPICS,
];

/**
 * Keeps the query cache in step with what the stream pushes: a snapshot is
 * written into it, a hint invalidates the entity's queries, and a `resync`
 * re-queries what may have changed while the stream was down. Mounted only
 * for a signed-in scope — an anonymous page would open a stream the service
 * refuses, which is not a decision, only a wasted request.
 */
function PushedEntities() {
  useReactiveCache(pushChannel, PUSHED_TOPICS);
  return null;
}

/**
 * Split out so the theme captions resolve against the locale `I18nProvider`
 * mounts — calling `useT` in `Providers` itself would read the fallback
 * instance, since that component sits *above* the provider it renders.
 *
 * Themes this app exposes: aurora/sunset/midnight are static CSS presets
 * (imported in global.css); "ocean" is defined only here and injected at
 * runtime — demonstrating brands not shipped as CSS (multi-tenant / dynamic).
 */
function ThemedProviders({
  children,
  scope,
}: PropsWithChildren<{ scope: string }>) {
  const t = useT('controls');
  const adapters = createClientAdapters();
  const themes = useMemo<ThemeOption[]>(
    () => [
      { id: 'aurora', label: t('themes.aurora') },
      { id: 'sunset', label: t('themes.sunset') },
      { id: 'midnight', label: t('themes.midnight') },
      { id: 'ocean', label: t('themes.ocean') },
    ],
    [t],
  );

  return (
    <EntifixQueryProvider>
      <ThemeProvider
        themes={themes}
        defaultTheme="aurora"
        storageKey="r10c-admin-theme"
        palettes={RUNTIME_PALETTES}
      >
        <UiPreferencesProvider store={uiPreferencesStore}>
          <ToastProvider>
            <MarketplaceAdminAdaptersProvider adapters={adapters}>
              {/* Above every route, not inside the workspace: a write handed
                to a flow — a create at `/new`, a cancel, a sale at the till —
                waits on plain routes no `WorkspaceShell` encloses, and its
                failure is toasted once by the region below (ADR 0073). */}
              <PendingFlowsProvider
                scope={scope}
                channel={pushChannel}
                readStatus={readFlowStatus}
              >
                {scope === ANONYMOUS_WORKSPACE_SCOPE ? null : (
                  <PushedEntities />
                )}
                {/* Each shell builds its own adapters against its own backend —
                  config-service, stock-, order-, fulfilment-, sales- and
                  settlement-service — so they are provided beside the
                  catalog's rather than through it. One composition root per
                  backend, and nesting them is only how React contexts stack. */}
                <SystemManagementProvider>
                  <StockProvider>
                    <OrderProvider>
                      <FulfilmentProvider>
                        <SalesProvider>
                          <SettlementProvider>{children}</SettlementProvider>
                        </SalesProvider>
                      </FulfilmentProvider>
                    </OrderProvider>
                  </StockProvider>
                </SystemManagementProvider>
              </PendingFlowsProvider>
            </MarketplaceAdminAdaptersProvider>
            <ToastRegion />
          </ToastProvider>
        </UiPreferencesProvider>
      </ThemeProvider>
    </EntifixQueryProvider>
  );
}

export function Providers({
  locale,
  scope,
  children,
}: PropsWithChildren<{ locale: Locale; scope: string }>) {
  return (
    <I18nProvider locale={locale}>
      <ThemedProviders scope={scope}>{children}</ThemedProviders>
    </I18nProvider>
  );
}
