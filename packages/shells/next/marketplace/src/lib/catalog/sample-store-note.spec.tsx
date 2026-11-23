import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SampleStoreNote } from './sample-store-note';

describe('SampleStoreNote', () => {
  it('says the store is a sample with illustrative prices', () => {
    render(
      <SampleStoreNote label="Tienda de muestra · precios ilustrativos" />,
    );

    expect(screen.getByTestId('sample-store-note').textContent).toContain(
      'Tienda de muestra · precios ilustrativos',
    );
  });
});
