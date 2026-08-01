import { Skeleton, SkeletonText, Stack } from '@r10c/entifix-react-controls/primitives';

import { ProductGridSkeleton } from '../catalog/product-grid';

/**
 * The route-level fallback, shared by every segment's `loading.tsx`.
 *
 * Deliberately geometric rather than decorative: the block heights match what
 * replaces them, so the swap causes no layout shift. A spinner would be
 * cheaper to write and would move the page twice — once to show it, once to
 * take it away.
 */
export function StorefrontSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl px-s py-l sm:px-l sm:py-xl">
      <Stack gap="l">
        <Stack gap="2xs">
          <Skeleton shape="line" className="w-24" />
          <Skeleton shape="block" className="h-[2em] w-2/3" />
          <SkeletonText lines={2} />
        </Stack>
        <ProductGridSkeleton />
      </Stack>
    </div>
  );
}
