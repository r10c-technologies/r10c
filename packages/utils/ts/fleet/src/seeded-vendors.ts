/**
 * The vendor organizations the local lab is seeded with — the one list every
 * seeding service reads, so auth, the catalog, stock, sales and settlement can
 * never disagree about who exists.
 *
 * It used to be one organization named by a `demoOrganizationId` row in five
 * services' configuration. A second vendor is what a basket spanning sellers
 * (ADR 0069), a settlement ledger with two payouts and a push stream with two
 * audiences need before any of them can be exercised end to end (#492), and a
 * list in five configuration rows would be five lists to keep in step.
 *
 * Seed data, not configuration: nothing here is a deployment fact, and an
 * environment that is not the local lab seeds nobody from it.
 */
export interface SeededVendor {
  /** The organization's id — and, prefixed, its tenant databases' names. */
  readonly organizationId: string;
  readonly name: string;
  readonly slug: string;
  /**
   * Prepended to every id this vendor's catalog and stock are seeded with.
   *
   * ⚠️ **Required to differ.** Two tenants may hold the same id privately, but
   * the published catalog is one platform-plane projection keyed by offering
   * id, so two vendors seeded with `product-offering-1` would overwrite each
   * other's publication.
   */
  readonly idPrefix: string;
  /** How many specifications, and so offerings, its catalog is seeded with. */
  readonly offerings: number;
}

export const SEEDED_VENDORS: readonly [SeededVendor, ...SeededVendor[]] = [
  {
    organizationId: 'demo-organization',
    name: 'Demo Vendor',
    slug: 'demo-vendor',
    idPrefix: '',
    offerings: 60,
  },
  {
    organizationId: 'second-organization',
    name: 'Second Vendor',
    slug: 'second-vendor',
    idPrefix: 'second-',
    // 24 rather than fewer: the catalog cycles status every 4 offerings and
    // currency every 3, and stock covers the first two thirds, so this is the
    // smallest count that gives this vendor a published GTQ offering on hand
    // (`second-product-offering-10`) — what a basket spanning both vendors
    // needs to be bought at all.
    offerings: 24,
  },
];

/** The first seeded vendor: the one Alan is a member of. */
export const DEMO_VENDOR = SEEDED_VENDORS[0];
