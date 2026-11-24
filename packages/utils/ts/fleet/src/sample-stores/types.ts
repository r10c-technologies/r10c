/**
 * The shape of the three sample stores the lab is seeded with (#676): a
 * hardware store, a phone-accessories store and a shoemaking-supplies store,
 * one per vertical the MVP is shown in (ADR 0080 §6).
 *
 * Plain literals rather than the vocabulary's types: a utility sits below the
 * business layer, so the units, statuses and regimes are spelled as strings
 * here and `sample-stores.spec.ts` checks every one against the vocabulary.
 */

/** The units the sample catalogs sell in, a subset of `SaleUnits`. */
export type SampleSaleUnit = 'UN' | 'PAR' | 'M' | 'YD' | 'LB' | 'L';

/** An offering's seeded status, one of `OfferingStatuses`. */
export type SampleOfferingStatus =
  'draft' | 'published' | 'unpublished' | 'pending-review';

/**
 * What the stock seed writes for an offering:
 *
 * - a number: one `receipt` of that many **whole** units, folded with a sale
 *   or an adjustment on some rows so a ledger is not one line everywhere;
 * - `'sold-out'`: a receipt and an equal sale, zero on hand reached through
 *   the ledger;
 * - `'none'`: no `StockItem` row at all, the different code path a
 *   reservation meets first (ADR 0010).
 */
export type SampleStock = number | 'sold-out' | 'none';

/** The drawing a product's generated picture uses. */
export type SampleArt =
  | 'cable'
  | 'wire'
  | 'screw'
  | 'nail'
  | 'anchor'
  | 'switch'
  | 'socket'
  | 'box'
  | 'hammer'
  | 'screwdriver'
  | 'tape'
  | 'pliers'
  | 'valve'
  | 'pipe'
  | 'saw'
  | 'level'
  | 'drill'
  | 'bottle'
  | 'case'
  | 'glass'
  | 'charger'
  | 'usb'
  | 'earbuds'
  | 'holder'
  | 'battery'
  | 'roll'
  | 'sole'
  | 'heel'
  | 'insole'
  | 'thread'
  | 'buckle'
  | 'eyelet'
  | 'zipper'
  | 'laces';

export interface SampleProduct {
  /** Stable and unique in its store: the picture's file name. */
  readonly key: string;
  /** Spanish: a specification's name is one string, authored by the vendor. */
  readonly name: string;
  readonly description: string;
  /** A key of `SAMPLE_BRANDS`. */
  readonly brand: string;
  /** A key of `SAMPLE_CATEGORIES`. */
  readonly category: string;
  readonly unit: SampleSaleUnit;
  /** In the unit's scale: `500` is half a metre, `1` one piece. */
  readonly step: number;
  readonly minimum: number;
  /** How many whole units `amount` buys: 1, or 100 for a part per hundred. */
  readonly pricePer: 1 | 100;
  /** GTQ minor units, IVA included (illustrative, never a real quote). */
  readonly amount: number;
  /**
   * Where the price steps down by quantity (ADR 0082 §8): from each `from` —
   * in the unit's scale — the whole line costs `amount` for `pricePer` units.
   */
  readonly tiers?: readonly {
    readonly from: number;
    readonly amount: number;
  }[];
  readonly status: SampleOfferingStatus;
  readonly stock: SampleStock;
  /**
   * The product in this store whose stock this one is sold from, and how
   * much of it — in that product's scale — one of this takes (ADR 0082 §7):
   * a 100 m roll of a cable stocked in metres is `{ key, factor: 100000 }`.
   * A presentation is sold by the piece and holds no stock of its own.
   */
  readonly drawsOn?: { readonly key: string; readonly factor: number };
  /** Seeded device-model ids the product is made for (#641). */
  readonly fits?: readonly string[];
  readonly art: SampleArt;
}

export interface SampleBrand {
  readonly name: string;
  readonly description: string;
  readonly retired?: true;
}

export interface SampleCategory {
  readonly code: string;
  readonly name: { readonly es: string; readonly en: string };
  readonly description: { readonly es: string; readonly en: string };
  /** A key of `SAMPLE_CATEGORIES`; absent on a root. */
  readonly parent?: string;
  readonly retired?: true;
  /** The colour the category's pictures are drawn in, as `#rrggbb`. */
  readonly tone: string;
}
