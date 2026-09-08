import type { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import {
  ButtonLink,
  Card,
  Cluster,
  HeadingThree,
  Stack,
  Text,
} from '@r10c/entifix-react-controls/primitives';
import { getServerTFor } from '@r10c/entifix-ts-i18n';
import { type Locale, localeHref } from '@r10c/entifix-ts-i18n/routing';

import { storePaths } from '../routing/paths';
import { formatMoney } from './money';

/**
 * An offering tile — entirely server-rendered, including its call to action.
 *
 * The CTA is a `ButtonLink`, not a `Button`. "View product" navigates, and
 * `Button` is a client component, so using one here would put a client boundary
 * around every tile in the grid: nine offerings, nine hydration roots, for a
 * link.
 *
 * The image is a flat placeholder at a fixed aspect ratio. There is no artwork
 * yet, but reserving the box now is what keeps the layout from jumping when
 * there is — the cheapest CLS fix there is.
 */
export interface OfferingCardProps {
  readonly locale: Locale;
  readonly offering: PublishedOffering;
  /**
   * The brand's name, resolved by the caller.
   *
   * ⚠️ A **name**, never the id. The snapshot carries `brandId` into
   * `catalog-reference` — another slice's store — and this card used to render
   * that id straight into the tile, which read as a brand only because the
   * fixtures were named to look like one. The grid resolves the whole
   * vocabulary once and hands each card its own; a reference nothing enforces
   * may dangle, and then the line is simply absent.
   */
  readonly brandName?: string;
}

export function OfferingCard({
  locale,
  offering,
  brandName,
}: OfferingCardProps) {
  const t = getServerTFor(locale, 'shell');

  return (
    <Card>
      <Stack gap="s">
        <div
          className="flex aspect-video items-center justify-center rounded-xl bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <span className="text-step-2 font-semibold">
            {offering.name.charAt(0)}
          </span>
        </div>

        <Stack gap="3xs">
          <HeadingThree>{offering.name}</HeadingThree>
          {brandName ? <Text muted>{brandName}</Text> : null}
          <Text muted lineClamp={2}>
            {offering.description}
          </Text>
        </Stack>

        <Cluster gap="s" justify="between">
          <Text weight="semibold">
            {formatMoney(locale, offering.amount, offering.currency)}
          </Text>
          {/*
            A hint, and the name says so: published data is eventually
            consistent on purpose and the checkout reservation is the truth
            (ADR 0009). Nothing moves it yet — M2's stock slice is what gives it
            a source — so today it reads `true` for everything the projector
            wrote.
          */}
          <Text muted>
            {offering.availableHint
              ? t('storefront.product.available')
              : t('storefront.product.unavailable')}
          </Text>
        </Cluster>

        <ButtonLink
          href={localeHref(locale, storePaths.offering(offering.offeringId))}
          variant="secondary"
        >
          {t('storefront.product.view')}
        </ButtonLink>
      </Stack>
    </Card>
  );
}
