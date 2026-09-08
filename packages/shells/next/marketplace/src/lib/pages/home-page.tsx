import {
  ButtonLink,
  HeadingOne,
  HeadingTwo,
  Lead,
  Overline,
  Stack,
} from '@r10c/entifix-react-controls/primitives';
import { getServerTFor } from '@r10c/entifix-ts-i18n';
import { type Locale, localeHref } from '@r10c/entifix-ts-i18n/routing';
import { Suspense } from 'react';

import { OfferingGrid, OfferingGridSkeleton } from '../catalog/offering-grid';
import { loadOfferings } from '../catalog/queries';
import { storePaths } from '../routing/paths';
import { StoreShell } from './store-shell';

/**
 * The storefront's front page. Prerendered, one copy per locale, revalidated on
 * the interval the route declares.
 *
 * The hero is rendered directly and the grid sits behind a `Suspense`, so the
 * first flush already carries the heading — the LCP element — while the catalog
 * query is still resolving. That race is what the boundary is for: the query is
 * now a real request to marketplace-service, not a fixture lookup.
 */
async function FeaturedOfferings({ locale }: { readonly locale: Locale }) {
  const t = getServerTFor(locale, 'shell');
  const page = await loadOfferings({ pageSize: 6, sort: 'name' });

  return (
    <OfferingGrid
      locale={locale}
      offerings={page.items}
      emptyLabel={t('storefront.category.empty')}
    />
  );
}

export function HomePage({ locale }: { readonly locale: Locale }) {
  const t = getServerTFor(locale, 'shell');

  return (
    <StoreShell locale={locale}>
      <Stack gap="l">
        <Stack gap="2xs">
          <Overline>{t('storefront.home.overline')}</Overline>
          <HeadingOne>{t('storefront.home.heading')}</HeadingOne>
          <Lead>{t('storefront.home.lead')}</Lead>
        </Stack>

        <Stack gap="s">
          <HeadingTwo>{t('storefront.home.featured')}</HeadingTwo>
          <Suspense fallback={<OfferingGridSkeleton />}>
            <FeaturedOfferings locale={locale} />
          </Suspense>
        </Stack>

        <div>
          <ButtonLink href={localeHref(locale, storePaths.search())}>
            {t('storefront.search.heading')}
          </ButtonLink>
        </div>
      </Stack>
    </StoreShell>
  );
}
