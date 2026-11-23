import { SAMPLE_CATEGORIES, SAMPLE_CATEGORY_IDS } from '@r10c/utils-ts-fleet';

/** A category's text in each locale the platform ships (ADR 0005). */
export interface LocalizedRecordText {
  es: string;
  en: string;
}

export interface ProductCategoryRecord {
  id: string;
  code: string;
  name: LocalizedRecordText;
  description: LocalizedRecordText;
  status: 'active' | 'retired';
  parentId?: string;
}

/**
 * The category tree the three sample stores sell under (#676), from
 * `SAMPLE_CATEGORIES`: one root per vertical and up to three levels below it
 * (ADR 0062). Written per locale rather than translated at render: a
 * category's name is content an operator authors, not copy (#572, #573).
 *
 * Two rows seed **retired** — a root with no children and a leaf under an
 * active parent — so the retire verb has rows it will legitimately fail on,
 * and no active category ever sits under a retired one. Changing this needs a
 * `dev:reset`.
 */
export const productCategoryTempData: ProductCategoryRecord[] =
  SAMPLE_CATEGORIES.map(([key, category]) => ({
    id: SAMPLE_CATEGORY_IDS[key],
    code: category.code,
    name: { ...category.name },
    description: { ...category.description },
    status: category.retired ? 'retired' : 'active',
    ...(category.parent === undefined
      ? {}
      : { parentId: SAMPLE_CATEGORY_IDS[category.parent] }),
  }));
