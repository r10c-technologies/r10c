import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Breadcrumbs } from './breadcrumbs.js';

describe('Breadcrumbs', () => {
  it('is a named trail, root first, the page itself last and unlinked', () => {
    render(
      <Breadcrumbs
        label="Ruta de navegación"
        items={[
          { label: 'Inicio', href: '/es' },
          { label: 'Iluminación', href: '/es/c/lighting' },
          { label: 'Lámparas de escritorio' },
        ]}
      />,
    );

    const trail = screen.getByRole('navigation', {
      name: 'Ruta de navegación',
    });
    const items = within(trail).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    const [, middle, last] = items as [HTMLElement, HTMLElement, HTMLElement];
    expect(within(middle).getByRole('link')).toHaveAttribute(
      'href',
      '/es/c/lighting',
    );
    const current = within(last).getByText('Lámparas de escritorio');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(within(last).queryByRole('link')).toBeNull();
  });

  it('keeps the last crumb unlinked even when given a link', () => {
    render(
      <Breadcrumbs label="Ruta" items={[{ label: 'Inicio', href: '/es' }]} />,
    );

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Inicio')).toHaveAttribute('aria-current', 'page');
  });

  it('renders a middle crumb without a link as plain text', () => {
    render(
      <Breadcrumbs
        label="Ruta"
        items={[{ label: 'Archivo' }, { label: 'Lámpara' }]}
      />,
    );

    expect(screen.getByText('Archivo')).not.toHaveAttribute('aria-current');
  });

  it('renders nothing for an empty trail', () => {
    const { container } = render(<Breadcrumbs label="Ruta" items={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
