import type { Locale } from '@entifix/core';
import { Cluster, Stack, Text } from '@entifix/react-controls/primitives';

import { storePaths } from '../routing/paths';
import { StoreLink } from '../routing/store-link';
import type { VariantAxisChoices } from './variant-choices';

export interface VariantPickerLabels {
  readonly label: string;
  readonly axis: (axis: VariantAxisChoices['axis']) => string;
  readonly unavailable: (value: string) => string;
}

/**
 * A product's variants as links (ADR 0085): one group per axis, the current
 * value marked `aria-current`, a sold-out one saying so in its own name. A
 * link rather than a radio because each value is another page — its own
 * price, stock and address — and a link works without a script.
 *
 * Plain labels in, so it renders the same in a server page and a spec.
 */
export function VariantPicker({
  axes,
  locale,
  labels,
}: {
  readonly axes: readonly VariantAxisChoices[];
  readonly locale: Locale;
  readonly labels: VariantPickerLabels;
}) {
  if (axes.length === 0) return null;
  return (
    <nav aria-label={labels.label} data-testid="variant-picker">
      <Stack gap="s">
        {axes.map(({ axis, choices }) => (
          <Stack gap="2xs" key={axis}>
            <Text weight="semibold" id={`variant-axis-${axis}`}>
              {labels.axis(axis)}
            </Text>
            <Cluster
              gap="xs"
              role="list"
              aria-labelledby={`variant-axis-${axis}`}
            >
              {choices.map(choice => (
                <span role="listitem" key={choice.offeringId + choice.value}>
                  <StoreLink
                    locale={locale}
                    href={storePaths.offering(choice.offeringId)}
                    aria-current={choice.current ? 'true' : undefined}
                    aria-label={
                      choice.available
                        ? undefined
                        : labels.unavailable(choice.value)
                    }
                    data-available={choice.available ? undefined : 'false'}
                    className={[
                      'touch-target inline-flex items-center rounded-md border px-s focus-ring',
                      choice.current
                        ? 'border-primary font-semibold'
                        : 'border-border',
                      choice.available ? '' : 'text-content-muted line-through',
                    ].join(' ')}
                  >
                    {choice.value}
                  </StoreLink>
                </span>
              ))}
            </Cluster>
          </Stack>
        ))}
      </Stack>
    </nav>
  );
}
