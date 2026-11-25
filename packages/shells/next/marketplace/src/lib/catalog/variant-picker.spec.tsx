import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  variantChoices,
  variantLabel,
  type VariantOffering,
} from './variant-choices';
import { VariantPicker } from './variant-picker';

const sole = (
  offeringId: string,
  color: string,
  size: string,
  availableHint = true,
): VariantOffering => ({
  offeringId,
  availableHint,
  variantValues: [
    { axis: 'color', value: color },
    { axis: 'size', value: size },
  ],
});

const SOLES = [
  sole('negro-40', 'negro', '40'),
  sole('negro-41', 'negro', '41'),
  sole('cafe-40', 'Café', '40', false),
  sole('cafe-42', 'café', '42'),
];

describe('variantChoices', () => {
  it('offers every value per axis, keeping the rest of the choice where it exists', () => {
    const [colors, sizes] = variantChoices(SOLES[0] as VariantOffering, SOLES);

    expect(colors?.axis).toBe('color');
    expect(colors?.choices).toEqual([
      {
        value: 'negro',
        offeringId: 'negro-40',
        current: true,
        available: true,
      },
      // Brown in size 40 exists, so switching colour keeps the size.
      {
        value: 'Café',
        offeringId: 'cafe-40',
        current: false,
        available: false,
      },
    ]);
    expect(sizes?.choices.map(choice => choice.offeringId)).toEqual([
      'negro-40',
      'negro-41',
      // No black 42: the nearest variant that is 42.
      'cafe-42',
    ]);
  });

  it('has nothing to pick for a lone variant, or for no variant', () => {
    expect(
      variantChoices(SOLES[0] as VariantOffering, [
        SOLES[0] as VariantOffering,
      ]),
    ).toEqual([]);
    expect(
      variantChoices({ offeringId: 'x', availableHint: true }, SOLES),
    ).toEqual([]);
  });

  it('skips a sibling that holds no value on an axis, or no variant at all', () => {
    const [colors] = variantChoices(SOLES[0] as VariantOffering, [
      ...SOLES,
      { offeringId: 'plain', availableHint: true },
      {
        offeringId: 'odd',
        availableHint: true,
        variantValues: [{ axis: 'size', value: '43' }],
      },
    ]);

    expect(colors?.choices).toHaveLength(2);
  });
});

describe('VariantPicker', () => {
  const labels = {
    label: 'Variantes',
    axis: (axis: string) => (axis === 'color' ? 'Color' : 'Talla'),
    unavailable: (value: string) => `${value}, agotado`,
  };

  it('renders one labelled list per axis, the current value marked', () => {
    render(
      <VariantPicker
        axes={variantChoices(SOLES[0] as VariantOffering, SOLES)}
        locale="es"
        labels={labels}
      />,
    );

    const nav = screen.getByRole('navigation', { name: 'Variantes' });
    const colors = within(nav).getByRole('list', { name: 'Color' });
    expect(within(colors).getByRole('link', { name: 'negro' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    // A sold-out value says so in its own name.
    expect(
      within(colors).getByRole('link', { name: 'Café, agotado' }),
    ).toHaveAttribute('href', expect.stringContaining('cafe-40'));
    expect(within(nav).getByRole('list', { name: 'Talla' })).toBeTruthy();
  });

  it('renders nothing when there is nothing to pick', () => {
    const { container } = render(
      <VariantPicker axes={[]} locale="es" labels={labels} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('variantLabel', () => {
  it('names each axis and its value, or nothing for no variant', () => {
    const axis = (name: string) => name.toUpperCase();
    expect(variantLabel(axis, SOLES[0]?.variantValues)).toBe(
      'COLOR: negro · SIZE: 40',
    );
    expect(variantLabel(axis, undefined)).toBeUndefined();
    expect(variantLabel(axis, [])).toBeUndefined();
  });
});
