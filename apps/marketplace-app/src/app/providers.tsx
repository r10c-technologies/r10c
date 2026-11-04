'use client';

// Installs r10c's catalogs into the i18next binding. Importing is the act.
import '@r10c/i18n-catalog';

import type { Locale } from '@entifix/core';
import {
  ANONYMOUS_WORKSPACE_SCOPE,
  PendingFlowsProvider,
} from '@entifix/next-shell';
import { ToastProvider, ToastRegion } from '@entifix/react-controls';
import { I18nProvider } from '@entifix/react-controls/i18next';
import {
  type ThemeOption,
  ThemeProvider,
  useT,
} from '@entifix/react-controls/primitives';
import { makeEventSourcePushChannel } from '@entifix/react-integration/event-source';
import { heldCapabilities } from '@r10c/shells-next-marketplace';
import { type PropsWithChildren, useMemo } from 'react';

/**
 * The tab's one push stream, through the edge's `/api/realtime` route
 * (ADR 0072). A storefront visitor holds no session, so there is nothing to
 * refresh; what admits them to their own checkout's flow is the capability the
 * order-status page holds while it waits, presented on every (re)open.
 */
const pushChannel = makeEventSourcePushChannel({
  url: '/api/realtime/stream',
  refresh: () => Promise.resolve(),
  capabilities: heldCapabilities,
});

/**
 * Split out so the theme captions resolve against the locale `I18nProvider`
 * mounts — calling `useT` in `Providers` itself would read the fallback
 * instance, since that component sits *above* the provider it renders.
 *
 * The storefront's own brand set (values in ./themes.css), distinct from admin's.
 */
function ThemedProviders({ children }: PropsWithChildren) {
  const t = useT('controls');
  const themes = useMemo<ThemeOption[]>(
    () => [
      { id: 'marketplace', label: t('themes.marketplace') },
      { id: 'marketplace-dark', label: t('themes.marketplaceDark') },
    ],
    [t],
  );

  return (
    <ThemeProvider
      themes={themes}
      defaultTheme="marketplace"
      storageKey="r10c-marketplace-theme"
    >
      {children}
    </ThemeProvider>
  );
}

export function Providers({
  locale,
  children,
}: PropsWithChildren<{ locale: Locale }>) {
  return (
    <I18nProvider locale={locale}>
      <ThemedProviders>
        <ToastProvider>
          {/* Anonymous: the store keeps flow ids only, and a flow settles by
              push or by the order-status page's own catch-up (ADR 0073). */}
          <PendingFlowsProvider
            scope={ANONYMOUS_WORKSPACE_SCOPE}
            channel={pushChannel}
          >
            {children}
          </PendingFlowsProvider>
          <ToastRegion />
        </ToastProvider>
      </ThemedProviders>
    </I18nProvider>
  );
}
