import { productBrandTempData } from './product-brand-temp-data';
import { productCategoryTempData } from './product-category-temp-data';

/**
 * A product's `brand` is returned as **embedded** data (the full brand object)
 * while its `category` is returned as a **foreign key** (the category id only).
 * This intentionally exercises both link shapes the deserializer/link resolver
 * must handle from a single payload.
 */
export interface ProductRecord {
  id: string;
  code: string;
  name: string;
  description: string;
  brand: {
    id: string;
    name: string;
    description: string;
    website: string;
  };
  category: string;
}

/**
 * Temporary, in-memory mock dataset. 60 products, each linking to a brand
 * (embedded) and a category (by id) drawn from the other mock pools. Not a
 * production source.
 */
export const productTempData: ProductRecord[] = Array.from(
  { length: 60 },
  (_, index) => {
    const number = index + 1;
    const brand = productBrandTempData[index % productBrandTempData.length];
    const category =
      productCategoryTempData[index % productCategoryTempData.length];
    return {
      id: `product-${number}`,
      code: `P-${String(number).padStart(4, '0')}`,
      name: `${brand.name} Product ${number}`,
      description: `Product #${number} in ${category.name}`,
      // Embedded relation — full brand object inline.
      brand: {
        id: brand.id,
        name: brand.name,
        description: brand.description,
        website: brand.website,
      },
      // Foreign-key relation — category referenced by id only.
      category: category.id,
    };
  }
);
