import type { ReactNode } from 'react';

export interface NarrowDisclosureProps {
  /** What the closed disclosure reads ("Filtrar (2)"), already translated. */
  readonly summary: string;
  readonly children: ReactNode;
}

/**
 * Folds its content away on a small screen behind a native disclosure, and
 * shows it open from `sm` up — so a storefront at 320px keeps what a buyer came
 * for on the first screen (WCAG 1.4.10), with no script.
 *
 * From `sm` up the content is forced open through `::details-content` and the
 * summary is hidden — both only where the browser supports that selector. One
 * that does not shows the summary on every screen, so the content starts
 * closed but can still be opened, rather than being hidden for good.
 */
export function NarrowDisclosure({ summary, children }: NarrowDisclosureProps) {
  return (
    <details className="sm:supports-[selector(::details-content)]:[&::details-content]:block sm:supports-[selector(::details-content)]:[&::details-content]:[content-visibility:visible]">
      <summary className="inline-flex min-h-(--target-min) cursor-pointer items-center rounded-md border border-border-control px-xs py-2xs font-semibold focus-ring sm:supports-[selector(::details-content)]:hidden">
        {summary}
      </summary>
      <div className="pt-s sm:supports-[selector(::details-content)]:pt-0">
        {children}
      </div>
    </details>
  );
}
