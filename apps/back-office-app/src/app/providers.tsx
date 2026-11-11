'use client';

// Installs r10c's catalogs into the i18next binding. Importing is the act.
import '@r10c/i18n-catalog';

import type { Locale } from '@entifix/core';
import {
  ANONYMOUS_WORKSPACE_SCOPE,
  PendingFlowsProvider,
} from '@entifix/next-shell';
import {
  type Density,
  makeIndexedDbUiPreferencesState,
  type ThemeOption,
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
import {
  OrganizationDialogsProvider,
  refreshSession,
} from '@r10c/shells-next-auth';
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

import {
  DEFAULT_DENSITY,
  DEFAULT_THEME,
  RUNTIME_PALETTES,
  THEME_STORAGE_KEY,
} from './theme-choices';

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
 * The back office offers its brand, `ocean` (a runtime palette), and
 * `midnight`, the two the screen gate measures; the account menu lists them
 * with the density choice, and the root layout has already rendered whichever
 * the reader stored, so nothing changes after load (#530).
 */
function ThemedProviders({
  children,
  scope,
  initialTheme,
  initialDensity,
}: PropsWithChildren<{
  scope: string;
  initialTheme: string;
  initialDensity: Density | undefined;
}>) {
  const t = useT('app');
  const adapters = createClientAdapters();
  const themes = useMemo<ThemeOption[]>(
    () => [
      { id: 'ocean', label: t('admin.themes.ocean') },
      { id: 'midnight', label: t('admin.themes.midnight') },
    ],
    [t],
  );

  return (
    <EntifixQueryProvider>
      <ThemeProvider
        themes={themes}
        defaultTheme={DEFAULT_THEME}
        defaultDensity={DEFAULT_DENSITY}
        storageKey={THEME_STORAGE_KEY}
        palettes={RUNTIME_PALETTES}
        initialTheme={initialTheme}
        {...(initialDensity === undefined ? {} : { initialDensity })}
      >
        <UiPreferencesProvider store={uiPreferencesStore}>
          <ToastProvider>
            {/* Around the toast region as well as the routes: a failure toasted
                there offers its next step — Choose organization, Who can grant
                — from the error actions this registers (#527). */}
            <OrganizationDialogsProvider>
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
            </OrganizationDialogsProvider>
          </ToastProvider>
        </UiPreferencesProvider>
      </ThemeProvider>
    </EntifixQueryProvider>
  );
}

export function Providers({
  locale,
  scope,
  initialTheme,
  initialDensity,
  children,
}: PropsWithChildren<{
  locale: Locale;
  scope: string;
  initialTheme: string;
  initialDensity: Density | undefined;
}>) {
  return (
    <I18nProvider locale={locale}>
      <ThemedProviders
        scope={scope}
        initialTheme={initialTheme}
        initialDensity={initialDensity}
      >
        {children}
      </ThemedProviders>
    </I18nProvider>
  );
}
