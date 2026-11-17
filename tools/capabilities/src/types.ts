/**
 * The vocabulary of the capability register (ADR 0080).
 *
 * An entry is deliberately thin: it carries no description, steps, copy,
 * rationale, owner, date or issue number. Each of those already has a home that
 * is checked or meant to be edited by people, and a prose field here would be
 * the second copy ADR 0025 exists to prevent.
 */

/** The three vertical guides of the MVP, and no others. A fourth is a one-line edit here plus a guide. */
export const VERTICALS = [
  'hardware',
  'phone-accessories',
  'shoemaking-supplies',
] as const;
export type Vertical = (typeof VERTICALS)[number];

/** Whether code for the use case exists — never when it will (ADR 0080 §5). */
export const STATUSES = ['implemented', 'planned', 'in-design'] as const;
export type CapabilityStatus = (typeof STATUSES)[number];

/** `<domain>:<entityKey>:<action>` — a permission's shape (ADR 0080 §1). */
export type CapabilityId = `${string}:${string}:${string}`;

export interface Capability {
  /** Unique across the register. For a verb it **is** its permission. */
  readonly id: CapabilityId;
  /** The ODA component, or `null`. Must equal the domain's value unless `odaOverride` says why not. */
  readonly oda: string | null;
  /** Why this entry sits in a different ODA component from the rest of its domain. */
  readonly odaOverride?: string;
  /** `<domain>:<entityKey>` of every entity read or written; the first is the subject. */
  readonly entities: readonly string[];
  /** Every permission a caller must hold, crossing permissions included. */
  readonly permissions: readonly string[];
  /** A workspace address without an id, or `storefront:<storePathsKey>`. */
  readonly screens: readonly string[];
  readonly status: CapabilityStatus;
  /** Which vertical guides may cite it; `all` means a guide for any vertical may. */
  readonly verticals: 'all' | readonly Vertical[];
}

/** One row of the domain table — the single place a domain's ODA analog is written. */
export interface DomainRow {
  /** The `@entity({ domain })` value, which is also the permission namespace. */
  readonly domain: string;
  /** The capability's name in the capability map. */
  readonly capability: string;
  /** The ODA component code entries default to, or `null` when none was found. */
  readonly oda: string | null;
  /** The ODA analog as the capability map prints it. */
  readonly odaAnalog: string;
  /** The `packages/business/ts/<name>` package, printed in the map without its `@r10c/` scope. */
  readonly packageName: string;
}
