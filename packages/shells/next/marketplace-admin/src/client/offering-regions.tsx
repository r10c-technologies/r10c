'use client';

import { getUCFactory } from '@entifix/business';
import { type Entity, formattingLocale } from '@entifix/core';
import {
  type CrudContext,
  crudContextOf,
  type EntityCrudRelated,
  useLocaleHref,
  useRegion,
} from '@entifix/next-shell';
import {
  ButtonLink,
  MediaGallery,
  MediaImage,
  Money,
  Stack,
  Text,
  useLocale,
  useT,
  useTranslateKey,
} from '@entifix/react-controls';
import { useEntityRecord } from '@entifix/react-integration';
import {
  type ProductOffering,
  ProductOfferingPrice,
  ProductSpecification,
} from '@r10c/business-ts-product-configuration-management';
import { useId } from 'react';

import { PRODUCT_SURFACE } from '../catalog-surfaces';
import type { MarketplaceAdminAdapters } from './client-types';
import { useMarketplaceAdminAdapters } from './marketplace-admin-context';

/**
 * What an offering's page shows of the records around it (#558, #564): its
 * price and its pictures, on its list row and on its own page.
 *
 * Both live in **this** slice — the price beside the offering, the pictures on
 * the specification it sells — so the shell declares them itself. What lives
 * in another slice (the stock held of it) is the host's to add, because a
 * shell may not build another shell's adapter (ADR 0077).
 */

/**
 * The specification's first picture, at thumbnail size and in a reserved box,
 * so a list of offerings never shifts as its images arrive. Its `alt` is the
 * vendor's own description of the picture (ADR 0061), not the product's name
 * again.
 */
function ThumbnailCell({
  specification,
}: {
  readonly specification: ProductSpecification;
}) {
  const first = specification.media?.[0];
  if (first === undefined) return <Text muted>—</Text>;
  return (
    <MediaImage
      src={first.url}
      alt={first.alt}
      sizes="3rem"
      className="size-12 rounded-md object-cover"
    />
  );
}

/**
 * A price as the vendor quoted it: the amount, and "por 100" when it buys more
 * than one unit — the unit itself is the list's own column. Read alone, Q7.50
 * the hundred is Q7.50 each (ADR 0082 §5).
 */
export function PriceCell({ price }: { readonly price: ProductOfferingPrice }) {
  const locale = useLocale();
  const t = useT('r10c');
  return (
    <span>
      <Money
        amount={price.amount}
        currency={price.currency}
        unit="minor"
        locale={locale}
      />
      {price.pricePer === 1
        ? null
        : ` ${t('marketplaceAdmin.offering.pricePer', {
            quantity: new Intl.NumberFormat(formattingLocale(locale)).format(
              price.pricePer,
            ),
          })}`}
    </span>
  );
}

/**
 * The offering list's price and picture columns: one read per column per page,
 * through this slice's own adapters (entifix 0030).
 */
export const OFFERING_RELATED_COLUMNS: readonly EntityCrudRelated<MarketplaceAdminAdapters>[] =
  [
    {
      key: 'price',
      labelKey: 'entity:product-offering.related.price',
      target: ProductOfferingPrice as never,
      repository: 'productOfferingPriceRest',
      match: 'offeringId',
      member: 'amount',
      render: (match: Entity) => (
        <PriceCell price={match as ProductOfferingPrice} />
      ),
    },
    {
      key: 'image',
      labelKey: 'entity:product-offering.related.image',
      target: ProductSpecification as never,
      repository: 'productRest',
      via: 'specificationId',
      member: 'media',
      render: (match: Entity) => (
        <ThumbnailCell specification={match as ProductSpecification} />
      ),
    },
  ];

/**
 * The offering's pictures: the specification's media, **read-only**.
 *
 * A specification can back several offerings, so editing its pictures from
 * one of them would silently change the others (ADR 0061). The region says
 * so, and leads to the specification, where the change is made knowingly.
 */
export function OfferingImagesRegion({
  offering,
}: {
  readonly offering: ProductOffering;
}) {
  const translateKey = useTranslateKey();
  const withLocale = useLocaleHref();
  const adapters = useMarketplaceAdminAdapters();
  const id = useId();
  const heading = translateKey('r10c:marketplaceAdmin.offering.regions.images');
  // Listed in the record's section nav beside the related lists, which
  // register themselves the same way (#597).
  useRegion(id, heading);

  const { entity: specification } = useEntityRecord<
    ProductSpecification,
    CrudContext
  >({
    uc: getUCFactory<ProductSpecification>(),
    ctx: crudContextOf(adapters, 'productRest'),
    id: offering.specificationId === '' ? undefined : offering.specificationId,
  });
  const media = specification?.media ?? [];

  return (
    <section id={id} aria-labelledby={`${id}-heading`}>
      <Stack gap="s">
        <h2
          id={`${id}-heading`}
          className="m-0 text-step-1 font-semibold text-content"
        >
          {heading}
        </h2>
        {media.length === 0 ? (
          <Text muted>
            {translateKey('r10c:marketplaceAdmin.offering.images.none')}
          </Text>
        ) : (
          <MediaGallery
            className="max-w-md"
            sizes="28rem"
            items={media.map((item, index) => ({
              id: `${id}-media-${index}`,
              src: item.url,
              alt: item.alt,
            }))}
            labels={{
              region: offering.name,
              previous: translateKey(
                'r10c:marketplaceAdmin.offering.images.previous',
              ),
              next: translateKey('r10c:marketplaceAdmin.offering.images.next'),
              position: (index, total) =>
                translateKey('r10c:marketplaceAdmin.offering.images.position', {
                  index,
                  total,
                }),
            }}
          />
        )}
        <Text muted>
          {translateKey('r10c:marketplaceAdmin.offering.images.shared')}
        </Text>
        {offering.specificationId === '' ? null : (
          <div>
            <ButtonLink
              variant="secondary"
              size="sm"
              href={withLocale(
                `${PRODUCT_SURFACE.basePath}/${offering.specificationId}`,
              )}
            >
              {translateKey('r10c:marketplaceAdmin.offering.images.edit')}
            </ButtonLink>
          </div>
        )}
      </Stack>
    </section>
  );
}
