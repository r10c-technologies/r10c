import { type Locale, localize } from '@entifix/core';

import type { ProductCategory } from '../entities/product-category';

/**
 * A category's name in `locale`, for a place that must print *something*: a
 * nav link, a crumb, a heading, a facet (#573).
 *
 * `localize` already falls back to the default locale. The code is the last
 * resort, for a record that carries neither — a validated one never does, but
 * an empty label would leave a link with no accessible name.
 */
export const categoryName = (
  category: Pick<ProductCategory, 'code' | 'name'>,
  locale: Locale,
): string => localize(category.name, locale) ?? category.code;

/** A category's description in `locale`, or `undefined` when it has none. */
export const categoryDescription = (
  category: Pick<ProductCategory, 'description'>,
  locale: Locale,
): string | undefined => localize(category.description, locale);
