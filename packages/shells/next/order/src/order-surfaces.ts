import {
  type Permission,
  permissionForEntity,
  screenAddress,
} from '@r10c/business-ts-authz';
import { ProductOrder } from '@r10c/business-ts-order-management';
import type { Entity, EntityConstructor } from '@r10c/entifix-ts-core';
import { EntifixBuildError, extractMetaEntity } from '@r10c/entifix-ts-core';
import type { EntityCatalogKey } from '@r10c/shells-next-common';

/**
 * One order screen, declared once, for everything that has to name it.
 *
 * ⚠️ **A separate type from `CatalogSurface`, not a flag on it.** That
 * declaration hard-codes the `master` screen type and says why: every catalog
 * screen is Definiciones, so a surface that is genuinely Operaciones is a
 * different declaration. These are that case — the first one
 * ([ADR 0033](../../../../../docs/adr/0033-the-screen-taxonomy.md)).
 *
 * **Why Operaciones and not Definiciones**, since this is the call #222 asked
 * to settle: by the taxonomy's own test, which is where the record came from.
 * A `ProductOrder` is written by the checkout saga behind a crossing token and
 * there is deliberately no route a person can write one with; the
 * recorded rather than authored; a `Reservation` is written by the checkout
 * crossing. Not one of the three is a thing you define and then reference.
 *
 * The verb test would have been the wrong one, and ADR 0033 says so: since
 * ADR 0026 every entity declares verbs, so treating a verb as grounds for
 * promotion would promote all of them.
 *
 * `permission` is **not** a member. It is `permissionForEntity(…, 'read')`,
 * derived from the entity's own `@entity({ domain, key })`, which is the whole
 * point of the `<domain>:<entityKey>:<action>` shape — a hand-written domain
 * string here could name a domain the route behind it does not check.
 */
export interface OrderSurface<TEntity extends Entity = Entity> {
  readonly entityConstructor: EntityConstructor<TEntity>;
  /**
   * `@entity({ key })`, stated rather than derived.
   *
   * Typed as {@link EntityCatalogKey}, so an entity whose catalog copy is
   * missing cannot be declared here at all; `makeEntityCrud` then re-reads the
   * decorator and throws if the two disagree, which is the check that survives
   * a rename of one and not the other.
   */
  readonly entityKey: EntityCatalogKey;
  /** `@entity({ pluralKey })` — the search group's heading. */
  readonly entityPluralKey: string;
  /** The route, which mirrors the entity key here — there is no `/catalog/product` case in this domain. */
  readonly basePath: string;
  readonly icon: string;
  /** Shell-namespaced nav copy. `app:` keys are lint-restricted to `apps/`. */
  readonly navLabelKey: string;
  /**
   * ⚠️ **`offeringId` on all three**, and not by preference:
   * `defineRecordSearchSource` refuses a label member that is not sortable,
   * filterable **and** a string, at module load. Every other member of these
   * entities is a number or an enum, so this is the only one that can name one
   * of their records.
   */
  readonly searchProperty: string;
  readonly labelProperty: string;
  readonly sublabelProperty?: string;
}

/** The `read` permission guarding a surface, derived from its entity. */
export const permissionForOrderSurface = (surface: OrderSurface): Permission =>
  permissionForEntity(surface.entityConstructor, 'read');

/**
 * The workspace tab address for a surface's list, and for one of its records.
 *
 * `operation`, which is what makes these the first `operation:` addresses in
 * the system — the address is the taxonomy serialized, so addressing an
 * Operaciones screen `master:` would be a lie the registry then had to keep
 * ([ADR 0042](../../../../../docs/adr/0042-the-workspace-address-is-the-taxonomy-serialized.md)).
 */
export const orderListAddress = (surface: OrderSurface): string =>
  screenAddress({ type: 'operation', key: surface.entityKey });

export const orderRecordAddress = (surface: OrderSurface, id: string): string =>
  screenAddress({ type: 'operation', key: surface.entityKey, id });

type OrderSurfaceDeclaration<TEntity extends Entity> = Omit<
  OrderSurface<TEntity>,
  'entityConstructor' | 'entityKey' | 'entityPluralKey'
> & { readonly entityKey: EntityCatalogKey };

/**
 * Declare a surface, reading off the decorator what the decorator already knows.
 *
 * `pluralKey` is optional on `MetaEntityOptions`, so an entity that never
 * declared one fails here — at module load, where the surface is declared —
 * rather than by titling a search group `undefined` on the first keystroke.
 */
export const orderSurface = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  declaration: OrderSurfaceDeclaration<TEntity>,
): OrderSurface<TEntity> => {
  const { pluralKey } = extractMetaEntity(entityConstructor);
  if (pluralKey === undefined) {
    throw new EntifixBuildError(
      `${entityConstructor.name} must declare pluralKey on @entity() to be an order surface`,
    );
  }
  return { ...declaration, entityConstructor, entityPluralKey: pluralKey };
};

export const PRODUCT_ORDER_SURFACE = orderSurface(ProductOrder, {
  entityKey: 'product-order',
  basePath: '/order/product-order',
  icon: '🧾',
  navLabelKey: 'shell:order.nav.orders',
  // The only member that can name an order to a human. `buyerId` is
  // `filterable` **and** `sortable` on the entity, which is what a search source
  // requires of a label member — it validates that at module load, so a
  // non-sortable choice here fails the process rather than the query.
  searchProperty: 'buyerId',
  labelProperty: 'buyerId',
  sublabelProperty: 'status',
});

/**
 * Every order surface this shell contributes.
 *
 * One, and the shape is deliberate rather than incomplete: an order's **lines**
 * are a `composition`, so they are columns of a detail grid inside this screen
 * and never a surface of their own. `OrderItem` carries no `@entity()` and has
 * no key to address, which is the mechanism saying the same thing
 * ([ADR 0034](../../../../../docs/adr/0034-composition-metadata.md)).
 */
export const ORDER_SURFACES: readonly OrderSurface[] = [PRODUCT_ORDER_SURFACE];
