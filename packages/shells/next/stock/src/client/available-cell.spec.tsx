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

  it('makes nothing to sell stand out, in words and not colour alone', () => {
    render(<AvailableCell item={itemWith(0)} />);

    expect(screen.getByText('Sin existencias disponibles')).toBeVisible();
  });
});
