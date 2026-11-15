import { describe, expect, it } from 'vitest';

import { categoryDescription, categoryName } from './category-name.js';

describe('categoryName', () => {
  it('reads the name in the reader’s locale', () => {
    const category = { code: 'PC-001', name: { es: 'Tazas', en: 'Mugs' } };

    expect(categoryName(category, 'es')).toBe('Tazas');
    expect(categoryName(category, 'en')).toBe('Mugs');
  });

  it('falls back to the code when no locale has a name', () => {
    expect(categoryName({ code: 'PC-001', name: {} }, 'es')).toBe('PC-001');
  });
});

describe('categoryDescription', () => {
  it('reads the description in the reader’s locale, or nothing', () => {
    expect(
      categoryDescription(
        { description: { es: 'Tazas y vasos', en: 'Mugs' } },
        'es',
      ),
    ).toBe('Tazas y vasos');
    expect(
      categoryDescription({ description: undefined }, 'es'),
    ).toBeUndefined();
  });
});
