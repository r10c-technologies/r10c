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

import { workspaceScope } from '../lib/workspace-scope';
import { fontVariables } from './fonts';
import { Providers } from './providers';

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
  // The locale the middleware negotiated. `lang` has to carry it: screen readers
  // pick their voice from it, and so does the browser's translate prompt.
  const locale = await getRequestLocale();
  // Who the persisted client stores belong to. Resolved here rather than per
  // page because the pending-write set spans the whole authenticated area — a
  // create happens on a plain catalog route, not in the workspace.
  const scope = await workspaceScope();
  return (
    // `data-scale` and `data-density` are read by `presets/fixed-scale.css`,
    // the same way `data-theme` is read by a palette. The back office is dense
    // operator work, so it takes the fixed 4px scale and compacts it — and
    // nothing below this element knows, which is the point: a control must
    // never learn which app it runs in.
    <html
      lang={locale}
      data-theme="aurora"
      data-scale="fixed"
      data-density="compact"
      className={fontVariables}
      suppressHydrationWarning
    >
      <body>
        <Providers locale={locale} scope={scope}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
