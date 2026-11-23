/**
 * What the **live** fleet's seed puts on the storefront.
 *
 * The rows themselves are written by three different services on boot — the
 * specifications and offerings by marketplace-admin-service, the brands and
 * categories by marketplace-service — and what reaches `published-catalog` is
 * only the subset ADR 0050's rebuild walk announces: the offerings the seed
 * stored `published`.
 *
 * Every one of those services reads the sample stores' data from
 * `@r10c/utils-ts-fleet` (#676), so this reads the same data rather than
 * restating a formula: a product added to a store moves these expectations
 * with it, and a seed writer that stopped following the data still fails the
 * journeys.
 */
import {
  SAMPLE_BRANDS,
  SAMPLE_CATEGORIES,
  sampleCategory,
  SEEDED_VENDORS,
} from '@r10c/utils-ts-fleet';

export interface SeededOffering {
  /** The storefront's address for it: `/p/<offeringId>` (ADR 0049). */
  readonly offeringId: string;
  /** The offering's own name, which is what the snapshot carries. */
  readonly name: string;
  /** The specification's `code`, copied onto the snapshot as merchandising. */
  readonly code: string;
  /** The category's `code` — the slug `/c/<code>` carries. */
  readonly categoryCode: string;
  /** The category's Spanish name, the category page's heading on `/es`. */
  readonly categoryName: string;
  /** The category's key in the sample vocabulary. */
  readonly categoryKey: string;
  /** The brand's name, rendered on the card and in the product page's overline. */
  readonly brandName: string;
  readonly amount: number;
  readonly currency: string;
  /** How many whole units `amount` buys. */
  readonly pricePer: number;
  readonly saleUnit: string;
  readonly status: string;
}

const brandName = (key: string): string =>
  SAMPLE_BRANDS.find(([candidate]) => candidate === key)?.[1].name ?? key;

const ALL_OFFERINGS: readonly SeededOffering[] = SEEDED_VENDORS.flatMap(
  vendor =>
    vendor.products.map((product, index): SeededOffering => {
      const category = sampleCategory(product.category);
      return {
        offeringId: `${vendor.idPrefix}product-offering-${String(index + 1)}`,
        name: product.name,
        code: `P-${String(index + 1).padStart(4, '0')}`,
        categoryCode: category.code,
        categoryName: category.name.es,
        categoryKey: product.category,
        brandName: brandName(product.brand),
        amount: product.amount,
        currency: 'GTQ',
        pricePer: product.pricePer,
        saleUnit: product.unit,
        status: product.status,
      };
    }),
);

/** Every offering the seed leaves `published`, and therefore in the projection. */
export const PUBLISHED_OFFERINGS: readonly SeededOffering[] =
  ALL_OFFERINGS.filter(offering => offering.status === 'published');

const required = <A>(value: A | undefined, what: string): A => {
  if (value === undefined) {
    throw new Error(`The live seed no longer has ${what}.`);
  }
  return value;
};

/**
 * A published offering sold by the piece and priced for one: what a journey
 * that types a quantity of `2` and expects twice the price means.
 */
export const A_PIECE: SeededOffering = required(
  PUBLISHED_OFFERINGS.find(
    offering => offering.saleUnit === 'UN' && offering.pricePer === 1,
  ),
  'a published offering sold by the piece',
);

/** The keys of `key` and every active category under it. */
const subtreeOf = (key: string): Set<string> => {
  const keys = new Set([key]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [candidate, category] of SAMPLE_CATEGORIES) {
      if (
        category.parent !== undefined &&
        keys.has(category.parent) &&
        category.retired === undefined &&
        !keys.has(candidate)
      ) {
        keys.add(candidate);
        grew = true;
      }
    }
  }
  return keys;
};

/**
 * What `/c/<code>` lists: the offerings in that category and in every active
 * category under it, because a category page lists its whole subtree.
 */
export const listedUnder = (categoryKey: string): readonly SeededOffering[] => {
  const keys = subtreeOf(categoryKey);
  return PUBLISHED_OFFERINGS.filter(offering => keys.has(offering.categoryKey));
};

/**
 * One offering the seed leaves `draft`.
 *
 * The storefront must not be able to reach it: `published-catalog` is a
 * projection of what was announced, not a copy of tenant storage, and a page
 * that resolved this id would mean the storefront was reading the wrong store.
 */
export const UNPUBLISHED_OFFERING: SeededOffering = required(
  ALL_OFFERINGS.find(offering => offering.status === 'draft'),
  'a draft offering',
);

/** How the storefront's `q` matches a name: contained, accents and case aside. */
const folded = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const publishedNamed = (word: string): readonly SeededOffering[] =>
  PUBLISHED_OFFERINGS.filter(offering =>
    folded(offering.name).includes(folded(word)),
  );

const wordsOf = (offerings: readonly SeededOffering[]): string[] =>
  [
    ...new Set(
      offerings.flatMap(offering =>
        offering.name.split(/[^\p{L}]+/u).filter(word => word.length >= 5),
      ),
    ),
  ].sort();

/**
 * A word the storefront must find, and every published offering it names:
 * at least two of them, few enough to fit one page.
 */
export const SEARCH_HIT: {
  readonly family: string;
  readonly published: readonly SeededOffering[];
} = (() => {
  const family = required(
    wordsOf(PUBLISHED_OFFERINGS).find(word => {
      const count = publishedNamed(word).length;
      return count >= 2 && count <= 6;
    }),
    'a word naming two to six published offerings',
  );
  return { family, published: publishedNamed(family) };
})();

/**
 * A word that names real specifications and no published offering — what
 * proves the storefront reads the **projection** rather than the catalog it
 * projects.
 */
export const SEARCH_MISS: { readonly family: string } = {
  family: required(
    wordsOf(
      ALL_OFFERINGS.filter(offering => offering.status !== 'published'),
    ).find(word => publishedNamed(word).length === 0),
    'a word naming only unpublished offerings',
  ),
};
