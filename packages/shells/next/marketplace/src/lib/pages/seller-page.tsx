import { type Locale, localeHref } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import {
  Cluster,
  HeadingOne,
  Overline,
  Stack,
} from '@entifix/react-controls/primitives';
import { whatsappChatUrl } from '@r10c/business-ts-order-contracts';
import {
  parseSearch,
  type SearchParams,
} from '@r10c/implementation-marketplace-catalog-next';
import { notFound } from 'next/navigation';

import { AddedNotice } from '../cart/added-notice';
import { OfferingListing } from '../catalog/offering-listing';
import { findSeller } from '../catalog/seller-read';
import { storePaths } from '../routing/paths';
import { storefrontOrigin } from '../seo/page-metadata';
import { StoreShell } from './store-shell';

/**
 * A seller's own page (#675): their offerings, under their name, with a link
 * to share it on WhatsApp — the address a seller pastes into a chat with a
 * customer. It is the search composition with the seller set in advance, as a
 * category page is with its category (#342), so filters, sort and paging work
 * the same way and the page needs no script.
 */
export interface SellerPageProps {
  readonly locale: Locale;
  readonly vendorId: string;
  readonly searchParams: SearchParams;
}

/**
 * A WhatsApp link that shares `text` with whoever the sender picks — no
 * number, so it is the share sheet and not a chat (#675).
 */
export const whatsappShareUrl = (text: string): string =>
  `https://wa.me/?text=${encodeURIComponent(text)}`;

export async function SellerPage({
  locale,
  vendorId,
  searchParams,
}: SellerPageProps) {
  const t = getServerTFor(locale, 'r10c');
  const seller = await findSeller(vendorId);
  if (!seller) notFound();

  // The path names the seller, so a `?seller=` on it is ignored.
  const state = { ...parseSearch(searchParams, locale), seller: [] };
  const url = `${storefrontOrigin()}${localeHref(locale, storePaths.seller(vendorId))}`;
  const chat = whatsappChatUrl(
    seller.whatsappNumber,
    t('storefront.seller.chatText', { seller: seller.name }),
  );

  return (
    <StoreShell
      locale={locale}
      notice={<AddedNotice locale={locale} query={searchParams} />}
    >
      <Stack gap="m">
        <Stack gap="2xs">
          <Overline>{t('storefront.seller.overline')}</Overline>
          <HeadingOne>{seller.name}</HeadingOne>
        </Stack>

        <Cluster gap="s">
          <a
            href={whatsappShareUrl(
              t('storefront.seller.shareText', { seller: seller.name, url }),
            )}
            target="_blank"
            rel="noreferrer noopener"
            className="touch-target underline"
            data-testid="seller-share"
          >
            {t('storefront.seller.share')}
          </a>
          {chat === undefined ? null : (
            <a
              href={chat}
              target="_blank"
              rel="noreferrer noopener"
              className="touch-target underline"
              data-testid="seller-chat"
            >
              {t('storefront.seller.chat')}
            </a>
          )}
        </Cluster>

        <OfferingListing
          locale={locale}
          path={storePaths.seller(vendorId)}
          state={state}
          vendorId={vendorId}
          emptyLabel={t('storefront.seller.empty')}
        />
      </Stack>
    </StoreShell>
  );
}
