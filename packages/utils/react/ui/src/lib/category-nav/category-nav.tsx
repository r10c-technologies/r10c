export interface CategoryLink {
  readonly label: string;
  readonly href: string;
  /** The category the page is showing, if it is one of these. */
  readonly current?: boolean;
}

export interface CategoryNavProps {
  /** The list's name, already translated ("Subcategorías"). */
  readonly label: string;
  readonly items: readonly CategoryLink[];
}

/**
 * A level of the category tree as links: the roots in the header, a
 * category's children on its page (ADR 0062).
 *
 * Which level to show is the caller's decision, made over entifix's
 * `buildTree`. This renders whatever list it is handed, and nothing for an
 * empty one, so a leaf category shows no heading over an empty list.
 */
export function CategoryNav({ label, items }: CategoryNavProps) {
  if (items.length === 0) return null;

  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-2xs">
        {items.map(item => (
          <li key={item.href}>
            <a
              href={item.href}
              aria-current={item.current ? 'page' : undefined}
              className={`inline-flex rounded-full border px-xs py-3xs ${
                item.current
                  ? 'border-primary text-primary'
                  : 'border-border text-content hover:border-primary'
              }`}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
