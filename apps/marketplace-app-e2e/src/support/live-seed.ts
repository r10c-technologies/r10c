/**
 * What the **live** fleet's seed puts on the storefront.
 *
 * The rows themselves are written by three different services on boot — the
 * specifications and offerings by marketplace-admin-service
 * (`product-temp-data.ts`, `offering-temp-data.ts`), the brands and categories
 * by marketplace-service (`product-brand-temp-data.ts`,
 * `product-category-temp-data.ts`) — and what reaches `published-catalog` is
 * only the subset ADR 0050's rebuild walk announces: the offerings the seed
 * stored `published`.
 *
 * The generation rules are **restated here rather than imported**, which is the
 * convention `back-office-app-e2e/src/support/catalog-seed.ts` already follows:
 * an e2e project reaching into an app's source couples two runtimes, and this
 * is fixture data — when the two diverge the live journeys fail, which is
 * exactly the signal wanted. What it costs is that a seed change has to be
 * mirrored here; what it buys is that a seed change nobody mirrored is caught
 * rather than absorbed.
 */

/** `product-temp-data.ts`: ten families of six, over 20 brands and 50 categories. */
const FAMILIES = [
  'Widget',
  'Gizmo',
  'Sprocket',
  'Cog',
  'Lever',
  'Piston',
  'Valve',
  'Gasket',
  'Bearing',
  'Flange',
];
const SPECIFICATION_COUNT = 60;
const BRAND_COUNT = 20;
const CATEGORY_COUNT = 50;

/** `product-brand-temp-data.ts` and `product-category-temp-data.ts`. */
const BRAND_NAMES = [
  'Acme',
  'Globex',
  'Umbrella',
  'Initech',
  'Soylent',
  'Hooli',
  'Stark',
  'Wayne',
  'Wonka',
  'Cyberdyne',
];
const CATEGORY_NAMES = [
  'Electronics',
  'Clothing',
  'Home & Kitchen',
  'Books',
  'Sports & Outdoors',
  'Beauty & Personal Care',
  'Toys & Games',
  'Automotive',
  'Health & Wellness',
  'Pet Supplies',
];

/**
 * `offering-temp-data.ts`: one offering per specification, statuses cycled so
 * every verb has a record it applies to and a record it must refuse. Only the
 * second of every four is ever announced.
 */
const STATUSES = ['draft', 'published', 'unpublished', 'pending-review'];

/** `offering-temp-data.ts`: 19.99, 24.99, 29.99 … in minor units, three currencies. */
const CURRENCIES = ['GTQ', 'USD', 'EUR'];

const cycled = (names: readonly string[], index: number) =>
  `${names[index % names.length]} ${Math.floor(index / names.length) + 1}`;

export interface SeededOffering {
  /** The storefront's address for it: `/p/<offeringId>` (ADR 0049). */
  readonly offeringId: string;
  /** The offering's own name, which is what the snapshot carries. */
  readonly name: string;
  /** The specification's `code`, copied onto the snapshot as merchandising. */
  readonly code: string;
  /** The category's `code` — the slug `/c/<code>` carries. */
  readonly categoryCode: string;
  /** The category's name, rendered as the category page's heading. */
  readonly categoryName: string;
  /** The brand's name, rendered on the card and in the product page's overline. */
  readonly brandName: string;
  readonly amount: number;
  readonly currency: string;
}

const offeringAt = (index: number): SeededOffering => {
  const number = index + 1;
  const brandNumber = (index % BRAND_COUNT) + 1;
  const categoryNumber = (index % CATEGORY_COUNT) + 1;

  return {
    offeringId: `product-offering-${number}`,
    name: `${cycled(FAMILIES, index)} — oferta`,
    code: `P-${String(number).padStart(4, '0')}`,
    categoryCode: `PC-${String(categoryNumber).padStart(3, '0')}`,
    categoryName: cycled(CATEGORY_NAMES, categoryNumber - 1),
    brandName: cycled(BRAND_NAMES, brandNumber - 1),
    amount: 1999 + index * 500,
    currency: CURRENCIES[index % CURRENCIES.length],
  };
};

const indices = Array.from(
  { length: SPECIFICATION_COUNT },
  (_, index) => index,
);

/** Every offering the seed leaves `published`, and therefore in the projection. */
export const PUBLISHED_OFFERINGS: readonly SeededOffering[] = indices
  .filter(index => STATUSES[index % STATUSES.length] === 'published')
  .map(offeringAt);

/**
 * One offering the seed leaves `draft`.
 *
 * The storefront must not be able to reach it: `published-catalog` is a
 * projection of what was announced, not a copy of tenant storage, and a page
 * that resolved this id would mean the storefront was reading the wrong store.
 */
export const UNPUBLISHED_OFFERING: SeededOffering = offeringAt(
  indices.find(index => STATUSES[index % STATUSES.length] === 'draft') ?? 0,
);

/** What the home page's featured grid shows: the first six by name, ascending. */
export const FEATURED_OFFERINGS: readonly SeededOffering[] = [
  ...PUBLISHED_OFFERINGS,
]
  // Plain byte order, not `localeCompare`: the ordering under test is the one
  // marketplace-service applies, and Mongo's default collation is a binary
  // comparison. A locale-aware sort here would agree today and disagree the
  // first time a seed name carried an accent.
  .sort((left, right) => (left.name < right.name ? -1 : 1))
  .slice(0, 6);

/**
 * A family the seed publishes more than once, and one it never publishes.
 *
 * The statuses cycle every four and the families every ten, so the two cycles
 * beat against each other: some families land on `published` repeatedly and
 * some never do at all. That second group is what makes a search assertion
 * meaningful — a term matching six specifications in tenant storage and no
 * published offering proves the storefront reads the **projection** rather than
 * the catalog it projects.
 */
const familyGroups = FAMILIES.map(family => ({
  family,
  published: PUBLISHED_OFFERINGS.filter(offering =>
    offering.name.startsWith(`${family} `),
  ),
}));

const familyWhere = (
  matches: (published: readonly SeededOffering[]) => boolean,
): { family: string; published: readonly SeededOffering[] } => {
  const found = familyGroups.find(group => matches(group.published));
  if (found === undefined) {
    throw new Error(
      'The live seed no longer produces the family groups the storefront search journeys need.',
    );
  }
  return found;
};

/** A term the storefront must find, and every published offering it names. */
export const SEARCH_HIT = familyWhere(published => published.length >= 2);

/** A term that names real specifications and no published offering. */
export const SEARCH_MISS = familyWhere(published => published.length === 0);
