import {
  Button,
  HeadingOne,
  Stack,
  Text,
  TextInput,
} from '@r10c/entifix-react-controls/primitives';
import { getServerTFor } from '@r10c/entifix-ts-i18n';
import type { Locale } from '@r10c/entifix-ts-i18n/routing';
import { Suspense } from 'react';

import { ProductGrid, ProductGridSkeleton } from '../catalog/product-grid';
import { loadProducts } from '../catalog/queries';
import { storePaths } from '../routing/paths';
import { StoreShell } from './store-shell';

/**
 * Search, rendered on the server from the query string.
 *
 * The form is a `GET` to this same route: submitting it changes the URL, the
 * server renders the results, and the page is shareable and back-buttonable for
 * free. No `onChange` handler, no debounce, no client-side fetch — the address
 * bar is the state.
 */
async function SearchResults({
  locale,
  term,
}: {
  readonly locale: Locale;
  readonly term: string;
}) {
  const t = getServerTFor(locale, 'shell');
  const page = await loadProducts({ search: term, pageSize: 12 });

  return (
    <Stack gap="s">
      <Text muted>{t('storefront.search.resultsFor', { term })}</Text>
      <ProductGrid
        locale={locale}
        products={page.items}
        emptyLabel={t('storefront.search.empty', { term })}
      />
    </Stack>
  );
}

export function SearchPage({
  locale,
  term,
}: {
  readonly locale: Locale;
  readonly term?: string;
}) {
  const t = getServerTFor(locale, 'shell');
  const trimmed = term?.trim();

  return (
    <StoreShell locale={locale}>
      <Stack gap="l">
        <HeadingOne>{t('storefront.search.heading')}</HeadingOne>

        <form
          action={`/${locale}${storePaths.search()}`}
          method="get"
          role="search"
        >
          <Stack direction="row" gap="s" align="center" wrap>
            <TextInput
              type="search"
              name="q"
              defaultValue={trimmed ?? ''}
              aria-label={t('storefront.search.label')}
              placeholder={t('storefront.search.placeholder')}
            />
            <Button type="submit">{t('storefront.search.submit')}</Button>
          </Stack>
        </form>

        {trimmed ? (
          <Suspense fallback={<ProductGridSkeleton count={4} />}>
            <SearchResults locale={locale} term={trimmed} />
          </Suspense>
        ) : (
          <Text muted>{t('storefront.search.prompt')}</Text>
        )}
      </Stack>
    </StoreShell>
  );
}
