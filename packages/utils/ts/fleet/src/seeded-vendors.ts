import { HARDWARE_PRODUCTS } from './sample-stores/hardware.js';
import { PHONE_ACCESSORY_PRODUCTS } from './sample-stores/phone-accessories.js';
import { SHOEMAKING_SUPPLY_PRODUCTS } from './sample-stores/shoemaking-supplies.js';
import type { SampleProduct } from './sample-stores/types.js';

/**
 * The vendor organizations the lab is seeded with — the one list every
 * seeding service reads, so auth, the catalog, stock, sales and settlement can
 * never disagree about who exists.
 *
 * Three **sample stores**, one per vertical the MVP is shown in (#676, ADR
 * 0080 §6): a hardware store, a phone-accessories store and a
 * shoemaking-supplies store. Each one's catalog is its own list of products in
 * `sample-stores/`, and every price is illustrative — the stores are flagged
 * `sampleStore`, and the storefront says so wherever it shows one.
 *
 * Between them they also give the fleet's journeys what used to need two
 * formula-built vendors: a basket spanning sellers (ADR 0069), a ledger with
 * several payouts, a push stream with several audiences, one seller per tax
 * regime, and offerings sold by the metre, the yard, the pound, the litre,
 * the pair and the hundred (ADR 0082).
 *
 * Seed data, not configuration: nothing here is a deployment fact, and an
 * environment that is not a lab seeds nobody from it.
 */
export interface SeededVendor {
  /** The organization's id — and, prefixed, its tenant databases' names. */
  readonly organizationId: string;
  /** The store's name. Invented: no real business is named (ADR 0025). */
  readonly name: string;
  readonly slug: string;
  /** The vertical the store shows, one of ADR 0080's `verticals`. */
  readonly vertical: 'hardware' | 'phone-accessories' | 'shoemaking-supplies';
  /**
   * Prepended to every id this vendor's catalog and stock are seeded with.
   *
   * ⚠️ **Required to differ.** Two tenants may hold the same id privately, but
   * the published catalog is one platform-plane projection keyed by offering
   * id, so two vendors seeded with `product-offering-1` would overwrite each
   * other's publication.
   */
  readonly idPrefix: string;
  /** The catalog, in order: a product's position is its seeded ids' number. */
  readonly products: readonly SampleProduct[];
  /**
   * The fiscal identity the organization is seeded with — written only when
   * the organization is first created, so a vendor's own edit survives a
   * boot. Illustrative NITs with valid check characters, and one store per
   * regime.
   */
  readonly fiscal: {
    readonly taxId: string;
    readonly legalName: string;
    readonly taxRegime: 'general' | 'small-taxpayer' | 'simplified';
    readonly establishmentCode: string;
  };
  /**
   * Whether the organization is seeded taking payment links (ADR 0081 §1) —
   * the hardware store does and the others do not, so a basket across stores
   * shows the tender offered for one seller and not another. Written only at
   * creation, like the fiscal identity.
   */
  readonly acceptsPaymentLink: boolean;
  /**
   * The WhatsApp number buyers may write to (#671), as E.164 — fictional, in
   * the 5555 range nobody is assigned; `''` for none, so a receipt across
   * stores shows the chat for one seller and not another. Written only at
   * creation.
   */
  readonly whatsappNumber: string;
  /**
   * Whether the store is a sample whose prices are illustrative (#676). Every
   * seeded store is one; an organization a person creates is not. Written
   * only at creation.
   */
  readonly sampleStore: boolean;
}

export const SEEDED_VENDORS: readonly [
  SeededVendor,
  SeededVendor,
  SeededVendor,
] = [
  {
    organizationId: 'hardware-store',
    name: 'Ferretería El Martillo',
    slug: 'ferreteria-el-martillo',
    vertical: 'hardware',
    // Empty: the first store keeps the unprefixed ids the service journeys
    // have always named (`product-offering-1`).
    idPrefix: '',
    products: HARDWARE_PRODUCTS,
    fiscal: {
      taxId: '10000003',
      legalName: 'Ferretería El Martillo, Sociedad Anónima',
      taxRegime: 'general',
      establishmentCode: '1',
    },
    acceptsPaymentLink: true,
    whatsappNumber: '+50255550100',
    sampleStore: true,
  },
  {
    organizationId: 'phone-accessories-store',
    name: 'Accesorios Punto Cel',
    slug: 'accesorios-punto-cel',
    vertical: 'phone-accessories',
    idPrefix: 'ph-',
    products: PHONE_ACCESSORY_PRODUCTS,
    fiscal: {
      taxId: '20000006',
      legalName: 'Accesorios Punto Cel',
      taxRegime: 'small-taxpayer',
      establishmentCode: '1',
    },
    acceptsPaymentLink: false,
    whatsappNumber: '',
    sampleStore: true,
  },
  {
    organizationId: 'shoemaking-supplies-store',
    name: 'Peletería La Horma',
    slug: 'peleteria-la-horma',
    vertical: 'shoemaking-supplies',
    idPrefix: 'sh-',
    products: SHOEMAKING_SUPPLY_PRODUCTS,
    fiscal: {
      taxId: '30000009',
      legalName: 'Peletería La Horma',
      taxRegime: 'simplified',
      establishmentCode: '1',
    },
    acceptsPaymentLink: false,
    whatsappNumber: '+50255550102',
    sampleStore: true,
  },
];

/** The hardware store: the one Alan is a member of by default. */
export const HARDWARE_STORE = SEEDED_VENDORS[0];
/** The phone-accessories store: Margaret's, and small-taxpayer. */
export const PHONE_ACCESSORIES_STORE = SEEDED_VENDORS[1];
/** The shoemaking-supplies store: Grace's, under the simplified regime. */
export const SHOEMAKING_SUPPLIES_STORE = SEEDED_VENDORS[2];

/**
 * Where a seeded product's picture is served: a path on the storefront's own
 * origin, generated at build time by `@r10c/sample-media` — never a third
 * party's host (#676, ADR 0061).
 */
/**
 * A sample product's SKU: its key, upper-cased — `taco-fisher` is
 * `TACO-FISHER`. Unique in its store because the key is, and made of what a
 * label prints, so the till scans it and a sheet updates it by it.
 */
export const sampleSkuOf = (product: Pick<SampleProduct, 'key'>): string =>
  product.key.toUpperCase();

export const sampleMediaPath = (
  vendor: Pick<SeededVendor, 'slug'>,
  product: Pick<SampleProduct, 'key'>,
): string => `/samples/${vendor.slug}/${product.key}.svg`;
