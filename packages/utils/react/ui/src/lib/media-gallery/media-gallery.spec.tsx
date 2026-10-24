import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MediaGallery } from './media-gallery.js';

const ITEMS = [
  { url: 'https://example.com/1.jpg', alt: 'Lámpara, brazo alzado' },
  { url: 'https://example.com/2.jpg', alt: 'Lámpara, desde arriba' },
];

describe('MediaGallery', () => {
  it('is a region named by its label, the first picture loaded eagerly', () => {
    render(<MediaGallery label="Imágenes del producto" items={ITEMS} />);

    const gallery = screen.getByRole('region', {
      name: 'Imágenes del producto',
    });
    const [first, second] = within(gallery).getAllByRole('img', {
      name: /Lámpara/,
    });
    expect(first).toHaveAttribute('loading', 'eager');
    expect(second).toHaveAttribute('loading', 'lazy');
  });

  it('links each thumbnail to its picture, named by it', () => {
    render(<MediaGallery label="Imágenes" items={ITEMS} />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[1]).toHaveAccessibleName('Lámpara, desde arriba');
    const target = links[1]?.getAttribute('href')?.slice(1) ?? '';
    expect(document.getElementById(target)).toHaveAttribute(
      'src',
      ITEMS[1]?.url,
    );
  });

  it('shows no thumbnails for a single picture', () => {
    render(<MediaGallery label="Imágenes" items={ITEMS.slice(0, 1)} />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('renders nothing without pictures', () => {
    const { container } = render(<MediaGallery label="Imágenes" items={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
