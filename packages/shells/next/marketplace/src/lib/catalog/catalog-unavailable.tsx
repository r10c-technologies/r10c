import type { Locale } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import { Alert } from '@entifix/react-controls/primitives';

/**
 * What a listing shows when its read failed rather than came back empty: a
 * polite status saying the catalog could not be reached, and a link that asks
 * again (H9, a4-31).
 *
 * ADR 0051 had a failed read render the empty-catalog copy, so a buyer could
 * not tell "nothing for sale" from "we could not ask". The read still renders
 * and still logs; only what the page says about it changed (ADR 0075).
 *
 * The retry is a link to the same address, not a button: the page is a server
 * render, and asking again is loading it again.
 */
export function CatalogUnavailable({
  locale,
  retryHref,
}: {
  readonly locale: Locale;
  readonly retryHref: string;
}) {
  const t = getServerTFor(locale, 'r10c');
  return (
    <Alert
      tone="warning"
      data-testid="catalog-unavailable"
      action={
        <a
          href={retryHref}
          className="rounded-sm font-semibold underline focus-ring"
        >
          {t('storefront.catalog.retry')}
        </a>
      }
    >
      {t('storefront.catalog.unavailable')}
    </Alert>
  );
}
