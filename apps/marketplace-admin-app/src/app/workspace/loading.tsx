/**
 * Server-rendered skeleton chrome shown while the workspace client hydrates —
 * a top-bar band, a tab-strip band, and body shimmer, matching the real layout
 * so the swap causes no shift. Pure markup (no client imports) so it stays a
 * server component and paints instantly.
 */
const shimmer = 'animate-pulse rounded-md bg-border/60 motion-reduce:animate-none';

export default function WorkspaceLoading() {
  return (
    <div className="min-h-screen">
      <div className="flex items-center gap-s border-b border-border bg-surface-elevated px-m py-s">
        <div className={`${shimmer} h-6 w-32`} />
        <div className={`${shimmer} ml-auto size-8 rounded-full`} />
      </div>
      <div className="flex items-end gap-3xs border-b border-border bg-surface px-2xs py-2xs">
        <div className={`${shimmer} h-7 w-28`} />
        <div className={`${shimmer} h-7 w-24`} />
        <div className={`${shimmer} h-7 w-24`} />
      </div>
      <div className="flex flex-col gap-2xs p-m">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className={`${shimmer} h-4 ${index === 7 ? 'w-2/3' : 'w-full'} max-w-2xl`} />
        ))}
      </div>
    </div>
  );
}
