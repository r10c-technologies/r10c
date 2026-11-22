import { extractMetaAccessors, findMetaEntity } from '@entifix/core';
import * as accessManagement from '@r10c/business-ts-access-management';
import * as authn from '@r10c/business-ts-authn';
import * as catalogReference from '@r10c/business-ts-catalog-reference';
import * as configuration from '@r10c/business-ts-configuration';
import * as marketplaceCatalog from '@r10c/business-ts-marketplace-catalog';
import * as marketplaceVendor from '@r10c/business-ts-marketplace-vendor';
import * as orderManagement from '@r10c/business-ts-order-management';
import * as partyManagement from '@r10c/business-ts-party-management';
import * as paymentManagement from '@r10c/business-ts-payment-management';
import * as productConfigurationManagement from '@r10c/business-ts-product-configuration-management';
import * as salesManagement from '@r10c/business-ts-sales-management';
import * as settlementManagement from '@r10c/business-ts-settlement-management';
import * as shippingOrderManagement from '@r10c/business-ts-shipping-order-management';
import * as stockManagement from '@r10c/business-ts-stock-management';

/**
 * Every domain package of the domain table. A package left out is caught by
 * the spec, which holds the graph to the entities `tools/slices` finds in
 * source.
 */
const PACKAGES: readonly object[] = [
  accessManagement,
  authn,
  catalogReference,
  configuration,
  marketplaceCatalog,
  marketplaceVendor,
  orderManagement,
  partyManagement,
  paymentManagement,
  productConfigurationManagement,
  salesManagement,
  settlementManagement,
  shippingOrderManagement,
  stockManagement,
];

type Constructor = Parameters<typeof extractMetaAccessors>[0];

/**
 * How one entity reaches another:
 * - `composition` — it owns the part, written and read with it;
 * - `link` — a declared `link` or `linkCollection`, joined by the adapter;
 * - `reference` — an id to a record in the same store;
 * - `id` — an id to a record in **another** store, which is never a link
 *   (docs/_shared/planes.md).
 */
export type RelationKind = 'composition' | 'link' | 'reference' | 'id';

export interface Declared {
  /** The member that declares it, dotted through the parts that own it. */
  readonly member: string;
  readonly type: 'composition' | 'link' | 'reference';
  /** `<domain>:<entityKey>`; absent on a part, which is no entity of its own. */
  readonly target?: string;
}

const isClass = (value: unknown): value is Constructor =>
  typeof value === 'function' && value.prototype !== undefined;

const resourceOf = (type: Constructor): string | undefined => {
  const meta = findMetaEntity(type);
  return meta?.domain === undefined || meta.key === undefined
    ? undefined
    : `${meta.domain}:${meta.key}`;
};

/**
 * What one class declares, through the parts it owns. Read from the raw
 * accessors rather than `describeEntityColumns`, which drops hidden members: a
 * hidden reference is still a relation.
 */
const declaredBy = (
  type: Constructor,
  self: string,
  prefix = '',
  seen: ReadonlySet<Constructor> = new Set([type]),
): Declared[] =>
  extractMetaAccessors(type)
    .filter(accessor => accessor.kind === 'getter')
    .flatMap((accessor): Declared[] => {
      const member = `${prefix}${String(accessor.name)}`;
      if (accessor.references !== undefined) {
        return [
          { member, type: 'reference', target: accessor.references.entity },
        ];
      }
      if (accessor.parent === true) {
        return [{ member, type: 'reference', target: self }];
      }
      if (accessor.type === 'link' || accessor.type === 'linkCollection') {
        const child = accessor.childType?.();
        const target = child === undefined ? undefined : resourceOf(child);
        if (target === undefined) {
          throw new Error(
            `docs-site: ${self} declares the link ${member} without naming its entity, so the map cannot draw it`,
          );
        }
        return [{ member, type: 'link', target }];
      }
      if (accessor.type !== 'composition') return [];
      const part = accessor.childType?.();
      return [
        { member, type: 'composition' },
        ...(part === undefined || seen.has(part)
          ? []
          : declaredBy(part, self, `${member}.`, new Set([...seen, part]))),
      ];
    });

const build = () => {
  const graph = new Map<string, readonly Declared[]>();
  for (const exported of PACKAGES.flatMap(pkg => Object.values(pkg))) {
    if (!isClass(exported)) continue;
    const resource = resourceOf(exported);
    if (resource !== undefined) {
      graph.set(resource, declaredBy(exported, resource));
    }
  }
  return graph;
};

/** Every entity, by `<domain>:<entityKey>`, with what it declares. */
export const ENTITY_GRAPH: ReadonlyMap<string, readonly Declared[]> = build();
