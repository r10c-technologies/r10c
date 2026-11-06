import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NarrowDisclosure } from './narrow-disclosure.js';

describe('NarrowDisclosure', () => {
  it('is a native disclosure that reads its summary and holds its content', () => {
    const { container } = render(
      <NarrowDisclosure summary="Ordenar: Nombre">
        <a href="/es/search?sort=name">Nombre</a>
      </NarrowDisclosure>,
    );

    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(details?.querySelector('summary')).toHaveTextContent(
      'Ordenar: Nombre',
    );
    expect(screen.getByText('Nombre')).toHaveAttribute(
      'href',
      '/es/search?sort=name',
    );
  });
});
