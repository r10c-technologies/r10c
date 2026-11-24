import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PriceTiers } from './price-tiers';

const labels = {
  heading: 'Precios por volumen',
  caption: 'Toda la línea se cobra al precio que alcanza su cantidad.',
  quantity: 'Cantidad',
  price: 'Precio',
};

describe('PriceTiers', () => {
  it('shows the base price and each tier as rows of a captioned table', () => {
    render(
      <PriceTiers
        rows={[
          { quantity: 'Menos de 10 m', amount: 1250 },
          { quantity: 'Desde 10 m', amount: 1100 },
        ]}
        currency="GTQ"
        locale="es"
        priceBasis="por m"
        labels={labels}
      />,
    );

    const table = screen.getByRole('table', { name: /Precios por volumen/ });
    expect(
      screen.getAllByRole('rowheader').map(cell => cell.textContent),
    ).toEqual(['Menos de 10 m', 'Desde 10 m']);
    expect(table.textContent).toContain('por m');
  });

  it('shows nothing for a price with no tiers, and no basis for one piece', () => {
    const { container } = render(
      <PriceTiers
        rows={[{ quantity: 'x', amount: 1 }]}
        currency="GTQ"
        locale="es"
        labels={labels}
      />,
    );
    expect(container.textContent).toBe('');

    render(
      <PriceTiers
        rows={[
          { quantity: 'Menos de 10 u.', amount: 500 },
          { quantity: 'Desde 10 u.', amount: 400 },
        ]}
        currency="GTQ"
        locale="es"
        labels={labels}
      />,
    );
    expect(
      screen
        .getAllByRole('cell')
        .map(cell => cell.textContent)
        .join(' '),
    ).not.toMatch(/por/);
  });
});
