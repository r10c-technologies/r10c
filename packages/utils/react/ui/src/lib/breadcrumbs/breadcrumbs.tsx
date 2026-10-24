export interface Crumb {
  readonly label: string;
  /** Absent on the last crumb, which is the page itself. */
  readonly href?: string;
}

export interface BreadcrumbsProps {
  /** The trail's name, already translated ("Ruta de navegación"). */
  readonly label: string;
  /** Root first, the current page last. */
  readonly items: readonly Crumb[];
}

/**
 * Where a page sits, root first: a category's ancestors, or a product's
 * category chain.
 *
 * An ordered list in a named `nav`, which is the pattern screen readers
 * announce as a trail. The last crumb is the page itself: it is text, not a
 * link, and carries `aria-current="page"`. The separators are drawn, not
 * read.
 */
export function Breadcrumbs({ label, items }: BreadcrumbsProps) {
  if (items.length === 0) return null;
  const last = items.length - 1;

  return (
    <nav aria-label={label}>
      <ol className="text-step--1 flex flex-wrap items-center gap-3xs text-content-muted">
        {items.map((item, index) => (
          <li
            key={`${index}:${item.label}`}
            className="flex items-center gap-3xs"
          >
            {index === last || item.href === undefined ? (
              <span
                aria-current={index === last ? 'page' : undefined}
                className={index === last ? 'text-content' : undefined}
              >
                {item.label}
              </span>
            ) : (
              <a className="hover:text-content" href={item.href}>
                {item.label}
              </a>
            )}
            {index === last ? null : <span aria-hidden="true">/</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
