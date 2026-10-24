import type { Locale } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import { HeadingOne, Stack } from '@entifix/react-controls/primitives';
import {
  parseSearch,
  type SearchParams,
} from '@r10c/implementation-marketplace-catalog-next';
import { Suspense } from 'react';

import { OfferingGridSkeleton } from '../catalog/offering-grid';
import { OfferingListing } from '../catalog/offering-listing';
import { storePaths } from '../routing/paths';
import { StoreShell } from './store-shell';

/**
 * Search, rendered on the server from the query string.
 *
 * The box is the header's: a `GET` to this route, so submitting it changes the
 * URL and the server renders the results. With no term the page lists the
 * whole catalog, and the facets narrow it from there. The address bar is the
 * state, so a search is shareable and back-buttonable with no client script.
 */
export function SearchPage({
  locale,
  searchParams,
}: {
  readonly locale: Locale;
  readonly searchParams: SearchParams;
}) {
  const t = getServerTFor(locale, 'r10c');
  const state = parseSearch(searchParams);
  const term = state.q[0]?.trim();

  return (
    <StoreShell locale={locale} searchTerm={term}>
      <Stack gap="l">
        <HeadingOne>
          {term
            ? t('storefront.search.resultsFor', { term })
            : t('storefront.search.heading')}
        </HeadingOne>

        <Suspense fallback={<OfferingGridSkeleton count={6} />}>
          <OfferingListing
            locale={locale}
            path={storePaths.search()}
            state={state}
            emptyLabel={
              term
                ? t('storefront.search.empty', { term })
                : t('storefront.listing.empty')
            }
          />
        </Suspense>
      </Stack>
    </StoreShell>
  );
}
