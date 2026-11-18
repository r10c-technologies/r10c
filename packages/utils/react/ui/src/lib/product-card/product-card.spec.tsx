import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProductCard } from './product-card.js';

const PRICE = { amount: 1999, currency: 'GTQ', locale: 'es-GT' } as const;
// Divided by 100 and given its symbol; the exact spacing is `Money`'s.
const FORMATTED = /^Q\s?19\.99$/;

const MEDIA = {
  url: 'https://example.com/lamp.jpg',
  alt: 'Lámpara de escritorio',
};

describe('ProductCard', () => {
  it('is an article named by its title', () => {
    render(<ProductCard title="Aurora Desk Lamp" price={PRICE} />);

    const card = screen.getByRole('article', { name: 'Aurora Desk Lamp' });
    expect(
      within(card).getByRole('heading', { level: 3, name: 'Aurora Desk Lamp' }),
    ).toHaveClass('line-clamp-2');
    expect(within(card).getByText(FORMATTED)).toBeInTheDocument();
  });

  it('takes the title id it is given, so two grids never share one (#726)', () => {
    render(
      <>
        <ProductCard
          title="Aurora Desk Lamp"
          titleId="newest-o-1-title"
          price={PRICE}
        />
        <ProductCard
          title="Terra Mug"
          titleId="featured-o-2-title"
          price={PRICE}
        />
      </>,
    );

    expect(
      screen.getByRole('article', { name: 'Aurora Desk Lamp' }),
    ).toHaveAttribute('aria-labelledby', 'newest-o-1-title');
    expect(screen.getByRole('article', { name: 'Terra Mug' })).toHaveAttribute(
      'aria-labelledby',
      'featured-o-2-title',
    );
  });

  it('renders every role it is given', () => {
    render(
      <ProductCard
        title="Aurora Desk Lamp"
        price={PRICE}
        brand="Aurora"
        seller="Vendido por Casa Solano"
        description="Warm dimmable LED."
        media={MEDIA}
        unitPrice="Q2.00 / unidad"
        badges={<span>Nuevo</span>}
        chips={<span>LED</span>}
        rating={<span>4,5</span>}
        availability={{ label: 'Disponible', available: true }}
        href="/es/p/1"
        cta={<button type="button">Añadir</button>}
      />,
    );

    for (const text of [
      'Aurora',
      'Vendido por Casa Solano',
      'Warm dimmable LED.',
      'Q2.00 / unidad',
      'Nuevo',
      'LED',
      '4,5',
      'Disponible',
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByRole('img', { name: MEDIA.alt })).toHaveAttribute(
      'src',
      MEDIA.url,
    );
    // The title is the card's one link, stretched over it (#568), and the
    // action sits above the stretch so it keeps its own taps.
    const link = screen.getByRole('link', { name: 'Aurora Desk Lamp' });
    expect(link).toHaveAttribute('href', '/es/p/1');
    expect(link).toHaveClass('after:absolute', 'after:inset-0');
    expect(
      within(screen.getByRole('heading', { level: 3 })).getByRole('link'),
    ).toBe(link);
    expect(
      screen.getByRole('button', { name: 'Añadir' }).parentElement,
    ).toHaveClass('relative', 'z-10');
  });

  it('leaves out what it is not given, keeping the media box', () => {
    const { container } = render(
      <ProductCard title="Terra Ceramic Mug" price={PRICE} />,
    );

    expect(screen.queryByRole('img')).toBeNull();
    const placeholder = container.querySelector('[aria-hidden="true"]');
    expect(placeholder).toHaveClass('aspect-video');
    expect(placeholder).toHaveTextContent('T');
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.querySelectorAll('p')).toHaveLength(1);
    // An absent seller draws nothing, not an empty line (#567).
    expect(screen.queryByTestId('card-seller')).toBeNull();
  });

  it('formats the price in minor units, and tags availability in words', () => {
    render(
      <ProductCard
        title="Mug"
        price={PRICE}
        availability={{ label: 'Agotado', available: false }}
      />,
    );

    expect(screen.getByText(FORMATTED)).toBeInTheDocument();
    expect(screen.getByText('Agotado')).toBeInTheDocument();
  });

  it.each([
    ['comfortable', 'gap-s'],
    ['compact', 'gap-xs'],
  ] as const)('spaces a %s card with %s', (density, gap) => {
    render(<ProductCard title="Mug" price={PRICE} density={density} />);

    const card = screen.getByRole('article');
    expect(card).toHaveAttribute('data-density', density);
    expect(card.firstElementChild).toHaveClass(gap);
  });
});
