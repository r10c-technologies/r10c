import {
  type Permission,
  permissionForEntity,
  screenAddress,
} from '@entifix/authz';
import type { Entity, EntityConstructor, FilterGroup } from '@entifix/core';
import { extractMetaEntity } from '@entifix/core';
import type { EntityCatalogKey } from '@entifix/next-shell';
import { ShippingOrder } from '@r10c/business-ts-shipping-order-management';

/**
 * One fulfilment screen, declared once, for everything that has to name it —
 * the nav item, the workspace tab, the search source and the generated pages.
 *
 * **Operaciones**, by the taxonomy's own test: a `ShippingOrder` is opened by
 * the checkout flow behind a crossing token, and no person can write one. A
 * vendor moves it with verbs, and a verb on a record is not grounds for a
 * different type ([ADR 0033](../../../../../docs/adr/0033-the-screen-taxonomy.md)).
 *
 * `permission` is not a member: it is `permissionForEntity(…, 'read')`, derived
 * from the entity's own `@entity({ domain, key })`, so it cannot name a domain
 * the route behind it does not check.
 */
export interface FulfilmentSurface<TEntity extends Entity = Entity> {
  readonly entityConstructor: EntityConstructor<TEntity>;
  /**
   * `@entity({ key })`, stated rather than derived, and typed so an entity
   * whose catalog copy is missing cannot be declared at all; `makeEntityCrud`
   * re-reads the decorator and throws if the two disagree.
   */
  readonly entityKey: EntityCatalogKey;
  /** `@entity({ pluralKey })` — the search group's heading. */
  readonly entityPluralKey: string;
  readonly basePath: string;
  readonly icon: string;
  /** Shell-namespaced nav copy. `app:` keys are lint-restricted to `apps/`. */
  readonly navLabelKey: string;
  readonly searchProperty: string;
  readonly labelProperty: string;
  readonly sublabelProperty?: string;
}

/** The `read` permission guarding a surface, derived from its entity. */
export const permissionForFulfilmentSurface = (
  surface: FulfilmentSurface,
): Permission => permissionForEntity(surface.entityConstructor, 'read');

/** The workspace tab address for a surface's list, and for one of its records. */
export const fulfilmentListAddress = (surface: FulfilmentSurface): string =>
  screenAddress({ type: 'operation', key: surface.entityKey });

export const fulfilmentRecordAddress = (
  surface: FulfilmentSurface,
  id: string,
): string => screenAddress({ type: 'operation', key: surface.entityKey, id });

type FulfilmentSurfaceDeclaration<TEntity extends Entity> = Omit<
  FulfilmentSurface<TEntity>,
  'entityConstructor' | 'entityKey' | 'entityPluralKey'
> & { readonly entityKey: EntityCatalogKey };

export const fulfilmentSurface = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  declaration: FulfilmentSurfaceDeclaration<TEntity>,
): FulfilmentSurface<TEntity> => {
  const { pluralKey } = extractMetaEntity(entityConstructor);
  if (pluralKey === undefined) {
    throw new Error(
      `${entityConstructor.name} must declare pluralKey on @entity() to be a fulfilment surface`,
    );
  }
  return { ...declaration, entityConstructor, entityPluralKey: pluralKey };
};

export const SHIPPING_ORDER_SURFACE = fulfilmentSurface(ShippingOrder, {
  entityKey: 'shipping-order',
  basePath: '/fulfilment/shipping-order',
  icon: '📦',
  navLabelKey: 'r10c:fulfilment.nav.shipments',
  // The only string member that names a shipment to a person: the order it
  // carries. A search source refuses a label member that is not sortable,
  // filterable and a string, at module load.
  searchProperty: 'orderId',
  labelProperty: 'orderId',
  sublabelProperty: 'status',
});

/**
 * The rows the shipments list opens on, which is what makes the screen a
 * **worklist**: the same record class with a default filter, never a second nav
 * place for it (ADR 0033). A vendor opens it to hand parcels to a courier; every
 * other status is one filter change away, in the panel where this shows.
 */
export const SHIPPING_ORDER_WORKLIST: FilterGroup<ShippingOrder> = {
  operator: 'and',
  values: [{ property: 'status', operator: 'eq', value: 'awaiting-dispatch' }],
};

/** Every fulfilment surface this shell contributes. */
export const FULFILMENT_SURFACES: readonly FulfilmentSurface[] = [
  SHIPPING_ORDER_SURFACE,
];
