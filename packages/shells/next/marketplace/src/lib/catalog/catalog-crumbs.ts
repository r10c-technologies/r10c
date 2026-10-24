import { type Locale, localeHref } from '@entifix/core';
import type { ProductCategory } from '@r10c/business-ts-catalog-reference';
import type { Crumb } from '@r10c/utils-react-ui';

import { storePaths } from '../routing/paths';

export interface CatalogCrumbsInput {
  readonly locale: Locale;
  /** The home crumb's label, already translated. */
  readonly home: string;
  /** A category and its ancestors, root first, as `loadCategoryTrail` reads them. */
  readonly trail: readonly Pick<ProductCategory, 'code' | 'name' | 'status'>[];
  /** The page below the trail, when it is not the last category: a product's name. */
  readonly leaf?: string;
}

/**
 * The breadcrumb trail of a catalog page: home, then the category chain, then
 * the product when there is one.
 *
 * ⚠️ A retired category is named but not linked. A product classified before
 * its category was retired still sits under it, so the trail says so, but the
 * retired category's own route 404s (#327), and a crumb that leads there would
 * be a broken link.
 */
export function catalogCrumbs({
  locale,
  home,
  trail,
  leaf,
}: CatalogCrumbsInput): Crumb[] {
  const crumbs: Crumb[] = [
    { label: home, href: localeHref(locale, storePaths.home()) },
    ...trail.map(category => ({
      label: category.name,
      href:
        category.status === 'active'
          ? localeHref(locale, storePaths.category(category.code))
          : undefined,
    })),
  ];
  return leaf === undefined ? crumbs : [...crumbs, { label: leaf }];
}
