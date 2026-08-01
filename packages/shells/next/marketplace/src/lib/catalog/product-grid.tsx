import type { Product } from '@r10c/business-ts-product-configuration-management';
import { Grid, Skeleton, Stack, Text } from '@r10c/entifix-react-controls/primitives';
import type { Locale } from '@r10c/entifix-ts-i18n/routing';

import { ProductCard } from './product-card';

export interface ProductGridProps {
  readonly locale: Locale;
  readonly products: readonly Product[];
  readonly emptyLabel: string;
}

export function ProductGrid({
  locale,
  products,
  emptyLabel,
}: ProductGridProps) {
  if (products.length === 0) {
    return <Text muted>{emptyLabel}</Text>;
  }

  return (
    <Grid min="18rem" gap="l">
      {products.map(product => (
        <ProductCard
          key={String(product.id)}
          locale={locale}
          product={product}
        />
      ))}
    </Grid>
  );
}

/**
 * What a streaming route flushes while the grid is still resolving. Same `Grid`
 * and same aspect ratio as the real thing, so the shell does not reflow when
 * the products arrive.
 */
export function ProductGridSkeleton({ count = 6 }: { readonly count?: number }) {
  return (
    <Grid min="18rem" gap="l">
      {Array.from({ length: count }, (_, index) => (
        <Stack key={index} gap="s">
          <Skeleton shape="block" className="aspect-video w-full" />
          <Skeleton shape="line" className="w-2/3" />
          <Skeleton shape="line" className="w-full" />
        </Stack>
      ))}
    </Grid>
  );
}
