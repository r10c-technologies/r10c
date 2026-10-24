import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PriceBlock } from './price-block.js';

describe('PriceBlock', () => {
  it('renders the price in the locale’s format', () => {
    render(
      <PriceBlock locale="en" price={{ amount: 1999, currency: 'USD' }} />,
    );

    expect(screen.getByText('$19.99')).toHaveClass('font-semibold');
    expect(screen.queryByText(/\//)).toBeNull();
  });

  it('adds the unit price under it when there is one', () => {
    render(
      <PriceBlock
        locale="en"
        price={{ amount: 1999, currency: 'USD' }}
        unitPrice={{ amount: 200, currency: 'USD', per: 'kg' }}
      />,
    );

    expect(screen.getByText('$2.00 / kg')).toBeInTheDocument();
  });
});
