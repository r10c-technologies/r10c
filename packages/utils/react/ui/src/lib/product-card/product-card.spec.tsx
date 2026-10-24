import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProductCard } from './product-card.js';

const MEDIA = {
  url: 'https://example.com/lamp.jpg',
  alt: 'Lámpara de escritorio',
};

describe('ProductCard', () => {
  it('is an article named by its title', () => {
    render(<ProductCard title="Aurora Desk Lamp" price="Q19.99" />);

    const card = screen.getByRole('article', { name: 'Aurora Desk Lamp' });
    expect(
      within(card).getByRole('heading', { level: 3, name: 'Aurora Desk Lamp' }),
    ).toHaveClass('line-clamp-2');
    expect(within(card).getByText('Q19.99')).toBeInTheDocument();
  });

  it('renders every role it is given', () => {
    render(
      <ProductCard
        title="Aurora Desk Lamp"
        price="Q19.99"
        brand="Aurora"
        description="Warm dimmable LED."
        media={MEDIA}
        unitPrice="Q2.00 / unidad"
        badges={<span>Nuevo</span>}
        chips={<span>LED</span>}
        rating={<span>4,5</span>}
        availability="Disponible"
        cta={<a href="/es/p/1">Ver producto</a>}
      />,
    );

    for (const text of [
      'Aurora',
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
    expect(screen.getByRole('link', { name: 'Ver producto' })).toBeVisible();
  });

  it('leaves out what it is not given, keeping the media box', () => {
    const { container } = render(
      <ProductCard title="Terra Ceramic Mug" price="Q34.99" />,
    );

    expect(screen.queryByRole('img')).toBeNull();
    const placeholder = container.querySelector('[aria-hidden="true"]');
    expect(placeholder).toHaveClass('aspect-video');
    expect(placeholder).toHaveTextContent('T');
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });

  it.each([
    ['comfortable', 'gap-s'],
    ['compact', 'gap-xs'],
  ] as const)('spaces a %s card with %s', (density, gap) => {
    render(<ProductCard title="Mug" price="Q1" density={density} />);

    const card = screen.getByRole('article');
    expect(card).toHaveAttribute('data-density', density);
    expect(card.firstElementChild).toHaveClass(gap);
  });
});
