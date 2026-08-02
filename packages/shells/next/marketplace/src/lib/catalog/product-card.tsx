import type { Product } from '@r10c/business-ts-product-configuration-management';
import {
  ButtonLink,
  Card,
  HeadingThree,
  Stack,
  Text,
} from '@r10c/entifix-react-controls/primitives';
import { getServerTFor } from '@r10c/entifix-ts-i18n';
import { type Locale, localeHref } from '@r10c/entifix-ts-i18n/routing';

import { storePaths } from '../routing/paths';

/**
 * A product tile — entirely server-rendered, including its call to action.
 *
 * The CTA is a `ButtonLink`, not a `Button`. "View product" navigates, and
 * `Button` is a client component, so using one here would put a client boundary
 * around every tile in the grid: nine products, nine hydration roots, for a
 * link.
 *
 * The image is a flat placeholder at a fixed aspect ratio. There is no artwork
 * yet, but reserving the box now is what keeps the layout from jumping when
 * there is — the cheapest CLS fix there is.
 */
export interface ProductCardProps {
  readonly locale: Locale;
  readonly product: Product;
}

export function ProductCard({ locale, product }: ProductCardProps) {
  const t = getServerTFor(locale, 'shell');
  const brand = product.brand.value?.name;

  return (
    <Card>
      <Stack gap="s">
        <div
          className="flex aspect-video items-center justify-center rounded-xl bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <span className="text-step-2 font-semibold">
            {product.name.charAt(0)}
          </span>
        </div>

        <Stack gap="3xs">
          <HeadingThree>{product.name}</HeadingThree>
          {brand ? <Text muted>{brand}</Text> : null}
          <Text muted lineClamp={2}>
            {product.description}
          </Text>
        </Stack>

        <ButtonLink
          href={localeHref(locale, storePaths.product(product.code))}
          variant="secondary"
        >
          {t('storefront.product.view')}
        </ButtonLink>
      </Stack>
    </Card>
  );
}
