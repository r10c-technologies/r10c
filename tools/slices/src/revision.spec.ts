import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BUSINESS_ROOT, sourceFiles } from './source-scan.js';

/**
 * The revision check names which records it protects (ADR 0079 §4, entifix
 * 0032), and this is the check that says so: an entity is either **authored**
 * — a document a person edits, so it declares `@accessor({ type: 'revision' })`
 * — or **excluded**, and an excluded one declares nothing. A new `@entity()` is
 * in neither list until somebody decides, which is what fails here.
 *
 * Read from source rather than from `Symbol.metadata` for the reason
 * `source-scan.ts` gives: an entity never exported would pass vacuously.
 */
const AUTHORED = [
  'ProductBrand',
  'ProductCategory',
  'DictionaryTerm',
  'ProductSpecification',
  'ProductOffering',
  'ProductOfferingPrice',
  'EntitySpecification',
  'CharacteristicSpecification',
  'SalesChannel',
  'Agreement',
  'Configuration',
];

/** Why each is not a document a person edits, grouped by the ADR's reasons. */
const EXCLUDED: Readonly<Record<string, string>> = {
  // Quantities and ledgers: `$inc` over append-only movements (ADR 0010).
  StockItem: 'a quantity',
  StockMovement: 'an append-only ledger',
  Reservation: 'a hold, moved by conditional verbs',
  // Status moves: each keeps its one conditional write on the status it leaves.
  ProductOrder: 'a status move',
  CheckoutGroup: 'a receipt written by a flow',
  ShippingOrder: 'a status move',
  // Append-only records written by a fold or a flow.
  Payment: 'an append-only record',
  PaymentAllocation: 'an append-only record',
  Refund: 'an append-only record',
  CommissionEntry: 'an append-only ledger',
  SettlementRun: 'written by a sweep',
  VendorPayout: 'written by a sweep',
  // Projections, ordered by the event's version.
  PublishedOffering: 'a projection',
  PublishedVendor: 'a projection',
  // Written by sign-in, provisioning and the provider, not by a form.
  UserIdentity: 'written by sign-in',
  UserDevice: 'written by sign-in',
  EntityIdentifier: 'written by sign-in',
  Individual: 'written by provisioning',
  Organization: 'written by provisioning',
  PartyRole: 'written by provisioning',
  Role: 'written by provisioning',
  Membership: 'written by provisioning',
  Entitlement: 'written by provisioning',
};

const entities = () => {
  const found = new Map<string, boolean>();
  for (const file of sourceFiles(BUSINESS_ROOT)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(
      /@entity\(\{[^)]*?\}\)\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gs,
    )) {
      found.set(match[1], /type:\s*'revision'/.test(text));
    }
  }
  return found;
};

describe('the revision check', () => {
  it('finds the entities it is asked to classify', () => {
    expect(entities().size).toBeGreaterThanOrEqual(
      AUTHORED.length + Object.keys(EXCLUDED).length - 4,
    );
  });

  it('is declared on every authored entity', () => {
    const found = entities();

    expect(AUTHORED.filter(name => found.get(name) !== true)).toEqual([]);
  });

  it('is declared on no excluded entity', () => {
    const found = entities();

    expect(
      Object.keys(EXCLUDED).filter(name => found.get(name) === true),
    ).toEqual([]);
  });

  it('leaves no entity undecided', () => {
    const decided = new Set([...AUTHORED, ...Object.keys(EXCLUDED)]);

    expect([...entities().keys()].filter(name => !decided.has(name))).toEqual(
      [],
    );
  });
});
