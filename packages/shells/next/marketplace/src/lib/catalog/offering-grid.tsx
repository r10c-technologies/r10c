import type { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import {
  Grid,
  Skeleton,
  Stack,
  Text,
} from '@r10c/entifix-react-controls/primitives';
import type { Locale } from '@r10c/entifix-ts-i18n/routing';

import { OfferingCard } from './offering-card';
import { loadBrands } from './queries';

export interface OfferingGridProps {
  readonly locale: Locale;
  readonly offerings: readonly PublishedOffering[];
  readonly emptyLabel: string;
}

/**
 * A grid of offerings, with brand names resolved **once for the whole page**.
 *
 * Per card it would be one request per tile for a value the vocabulary is small
 * enough to hold entirely — and the reads are sequential inside a server
 * component, so a nine-tile grid would be nine round trips before the first
 * byte. Resolving here also keeps `OfferingCard` free of any data access, which
 * is what lets it be asserted without a backend.
 */
export async function OfferingGrid({
  locale,
  offerings,
  emptyLabel,
}: OfferingGridProps) {
  if (offerings.length === 0) {
    return <Text muted>{emptyLabel}</Text>;
  }

  const brands = await loadBrands();
  const nameOf = new Map(
    brands.items.map(brand => [String(brand.id), brand.name]),
  );

  return (
    <Grid min="18rem" gap="l">
      {offerings.map(offering => (
        <OfferingCard
          key={offering.offeringId}
          locale={locale}
          offering={offering}
          brandName={
            offering.brandId === undefined
              ? undefined
              : nameOf.get(offering.brandId)
          }
        />
      ))}
    </Grid>
  );
}

/**
 * What a streaming route flushes while the grid is still resolving. Same `Grid`
 * and same aspect ratio as the real thing, so the shell does not reflow when
 * the offerings arrive.
 */
export function OfferingGridSkeleton({
  count = 6,
}: {
  readonly count?: number;
}) {
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
