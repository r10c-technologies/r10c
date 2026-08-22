import {
  Skeleton,
  SkeletonText,
} from '@r10c/entifix-react-controls/primitives';

/**
 * Server-rendered skeleton chrome shown while the workspace client hydrates —
 * a top-bar band, a tab-strip band, and body shimmer, matching the real layout
 * so the swap causes no shift. The host `(authenticated)/layout.tsx` already
 * supplies the sidebar/top bar, so this only covers the workspace's own
 * content.
 *
 * It imports from `/primitives`, not the package's flat main barrel: that entry
 * reaches `EntityTable` and the UI-preferences store behind it, which would drag
 * the Effect runtime into a route whose whole job is to paint instantly. Nothing
 * here is a client component — `Skeleton` carries no `'use client'` — so this
 * stays a server component.
 */
export default function WorkspaceLoading() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-s border-b border-border bg-surface-elevated px-m py-2xs">
        <Skeleton shape="circle" className="ml-auto size-8" />
      </div>
      <div className="flex items-end gap-3xs border-b border-border bg-surface px-2xs py-2xs">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="p-m">
        <SkeletonText lines={8} className="max-w-2xl" />
      </div>
    </div>
  );
}
