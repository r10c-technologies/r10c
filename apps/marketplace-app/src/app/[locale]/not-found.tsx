'use client';

import {
  HeadingOne,
  Lead,
  Stack,
  useT,
} from '@entifix/react-controls/primitives';
import Link from 'next/link';
import { useParams } from 'next/navigation';

/**
 * What `notFound()` renders anywhere under a locale — a `/p/` or `/c/` address
 * the proxy sent to `/missing`, or a page whose read named nothing.
 *
 * Without this file Next served its built-in page, outside the `[locale]`
 * layout: no palette, no `lang`, no skip link and no way on — a dead end the
 * accessibility gate found (ADR 0075). This one renders inside the layout, so
 * the theme and the providers apply, and gives the visitor a skip link, a
 * `main` and a link home. A client component, because a not-found boundary
 * receives no params; the locale comes from the URL the visitor asked for.
 */
export default function NotFound() {
  const t = useT('r10c');
  const { locale } = useParams<{ locale: string }>();

  return (
    <>
      <a
        href="#content"
        className="sr-only focus-ring focus:not-sr-only focus:absolute focus:top-s focus:left-s focus:z-50 focus:rounded-md focus:bg-surface-elevated focus:px-s focus:py-2xs focus:text-content"
      >
        {t('storefront.nav.skipToContent')}
      </a>
      <main
        id="content"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl px-s py-l sm:px-l sm:py-xl"
      >
        <Stack gap="s">
          <HeadingOne>{t('storefront.missing.heading')}</HeadingOne>
          <Lead>{t('storefront.missing.body')}</Lead>
          <Link
            href={`/${locale}`}
            className="text-primary underline underline-offset-2"
          >
            {t('storefront.missing.home')}
          </Link>
        </Stack>
      </main>
    </>
  );
}
