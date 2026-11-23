import { StockItem } from '@r10c/business-ts-stock-management';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AvailableCell } from './stock-crud.js';

const itemWith = (available: number) =>
  Object.assign(new StockItem('product-offering-1'), { available });

describe('AvailableCell', () => {
  it('shows what can still be sold as the number it is', () => {
    render(<AvailableCell item={itemWith(7)} />);

    expect(screen.getByText('7')).toBeInTheDocument();
  });

  // ADR 0082 §2: in the item's unit, as the generated cells beside it read.
  it('states what is left in the item’s unit, never the scaled integer', () => {
    render(
      <AvailableCell
        item={Object.assign(itemWith(40_900), { unit: 'M' as const })}
      />,
    );

    expect(screen.getByText('40.9 m')).toBeInTheDocument();
  });

  it('makes nothing to sell stand out, in words and not colour alone', () => {
    render(<AvailableCell item={itemWith(0)} />);

    expect(screen.getByText('Sin existencias disponibles')).toBeVisible();
  });
});
