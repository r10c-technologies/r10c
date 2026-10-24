import { Cluster, Text } from '@entifix/react-controls/primitives';
import { useId } from 'react';

export interface SortOption {
  readonly value: string;
  readonly label: string;
}

export interface SortControlProps {
  /** The control's name, already translated ("Ordenar por"). */
  readonly label: string;
  readonly options: readonly SortOption[];
  /** The option in force, which may be none: then the default order applies. */
  readonly current?: string;
  /** Where choosing `value` leads: the same listing, re-sorted, from page 1. */
  readonly hrefFor: (value: string) => string;
}

/**
 * One order out of several, each a link.
 *
 * It works without JavaScript because the URL is the state: choosing an order
 * is a navigation and the server renders the answer. The order in force is
 * marked `aria-current`, which also gives it its weight. entifix's
 * `SortBuilder` is the admin's multi-key builder, and this is not that.
 */
export function SortControl({
  label,
  options,
  current,
  hrefFor,
}: SortControlProps) {
  const labelId = useId();

  return (
    <nav aria-labelledby={labelId}>
      <Cluster gap="s">
        <Text id={labelId} muted as="span">
          {label}
        </Text>
        {options.map(option => {
          const active = option.value === current;
          return (
            <a
              key={option.value}
              href={hrefFor(option.value)}
              aria-current={active ? 'true' : undefined}
              className={
                active
                  ? 'font-semibold text-content'
                  : 'text-content-muted hover:text-content'
              }
            >
              {option.label}
            </a>
          );
        })}
      </Cluster>
    </nav>
  );
}
