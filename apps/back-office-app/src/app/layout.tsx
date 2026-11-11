import './global.css';
// ⚠️ Installs r10c's catalogs for the **server** graph. `providers.tsx` does the
// same for the client, and neither reaches the other: a Next app's server and
// client are separate bundles with separate module state, so an install that
// only ran in the `'use client'` provider left `getServerT` below with an empty
// registry and every render threw `No i18n catalogs are installed`. The root
// layout is evaluated before its own `generateMetadata` and before every page
// under it, which is why this is the one place that covers them all.
import '@r10c/i18n-catalog';

import { getRequestLocale, getServerT } from '@entifix/next-i18n/server';
import { readThemeCookies } from '@entifix/next-shell/server';
import { cookies } from 'next/headers';

import { workspaceScope } from '../lib/workspace-scope';
import { fontVariables } from './fonts';
import { Providers } from './providers';
import {
  DEFAULT_DENSITY,
  DEFAULT_THEME,
  runtimePaletteCss,
  THEME_IDS,
  THEME_STORAGE_KEY,
} from './theme-choices';

/**
 * Title and description are per-request now: they are the first thing a visitor
 * and a crawler read, so leaving them in one language would undo the rest.
 */
export async function generateMetadata() {
  const t = await getServerT('app');
  return { title: t('admin.title'), description: t('admin.description') };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The locale the proxy negotiated. `lang` has to carry it: screen readers
  // pick their voice from it, and so does the browser's translate prompt.
  const locale = await getRequestLocale();
  // Who the persisted client stores belong to. Resolved here rather than per
  // page because the pending-write set spans the whole authenticated area — a
  // create happens on a plain catalog route, not in the workspace.
  const scope = await workspaceScope();
  // The reader's own theme and density, read with the request so the page is
  // rendered in them: no paint in the wrong palette, and no attribute that
  // changes after load (#530).
  const { theme, density } = readThemeCookies(await cookies(), {
    themes: THEME_IDS,
    defaultTheme: DEFAULT_THEME,
    defaultDensity: DEFAULT_DENSITY,
    storageKey: THEME_STORAGE_KEY,
  });
  return (
    // `data-scale` and `data-density` are read by `presets/fixed-scale.css`,
    // the same way `data-theme` is read by a palette. The back office takes
    // the fixed 4px scale, compact unless the reader chose comfortable — and
    // nothing below this element knows, which is the point: a control must
    // never learn which app it runs in.
    <html
      lang={locale}
      data-theme={theme}
      data-scale="fixed"
      data-density={density ?? DEFAULT_DENSITY}
      className={fontVariables}
      suppressHydrationWarning
    >
      <head>
        {/* The brand palette's rules, with the page rather than after
            hydration (see `runtimePaletteCss`). Static data, never input. */}
        <style>{runtimePaletteCss()}</style>
      </head>
      <body>
        <Providers
          locale={locale}
          scope={scope}
          initialTheme={theme}
          initialDensity={density}
        >
          {children}
        </Providers>
      </body>
    </html>
  );
}
