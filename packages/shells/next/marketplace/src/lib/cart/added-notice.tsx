import { type Locale, localeHref } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import { Alert, ButtonLink } from '@entifix/react-controls/primitives';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import {
  getOffering,
  type SearchParams,
} from '@r10c/implementation-marketplace-catalog-next';

import { runRead } from '../catalog/catalog-reads';
import { storePaths } from '../routing/paths';
import { parseCartNotice } from './cart-notice';

/** A route's query in either shape it arrives in, as the notice parser reads it. */
const asQuery = (query: SearchParams) =>
  query instanceof URLSearchParams ? Object.fromEntries(query) : query;

/**
 * What a card's add says on the listing it returned to (#574): a polite
 * status naming what went in, and the way to the cart.
 *
 * A server component reading the query inside its own `Suspense` hole, so the
 * page around it stays prerendered and the notice still renders with
 * scripting off. It reads only an id from the URL and the name from the
 * catalog, never copy from the address bar. `added` is no indexable address:
 * a listing's canonical drops its query.
 */
export async function AddedNotice({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: Promise<SearchParams> | SearchParams;
}) {
  const notice = parseCartNotice(asQuery(await query));
  if (notice?.kind !== 'added') return null;

  const offering = await runRead(
    PublishedOffering,
    getOffering(notice.offeringId),
    undefined,
  );
  if (offering === undefined) return null;

  const t = getServerTFor(locale, 'r10c');
  return (
    <Alert
      tone="success"
      data-testid="listing-added"
      className="mb-s"
      action={
        <ButtonLink
          href={localeHref(locale, storePaths.cart())}
          variant="secondary"
          size="sm"
          className="touch-target"
        >
          {t('storefront.cart.view')}
        </ButtonLink>
      }
    >
      {t('storefront.cart.added', { name: offering.name })}
    </Alert>
  );
}
