import {
  type Permission,
  permissionForEntity,
  screenAddress,
} from '@r10c/business-ts-authz';
import { SalesChannel } from '@r10c/business-ts-sales-management';
import type { Entity, EntityConstructor } from '@r10c/entifix-ts-core';
import { EntifixBuildError, extractMetaEntity } from '@r10c/entifix-ts-core';
import type { EntityCatalogKey } from '@r10c/shells-next-common';

/**
 * One sales screen, declared once, for everything that has to name it.
 *
 * ⚠️ **Definiciones, unlike stock's surfaces and by the same test.** ADR 0033's
 * question is who made the record: a `StockItem` is created by a movement's
 * upsert and a `Reservation` by the checkout crossing, so both are Operaciones.
 * A `SalesChannel` is the opposite — a vendor names their counter, and every
 * order placed through it then *references* that record. Defining a thing and
 * referring to it later is exactly what Definiciones means
 * ([ADR 0033](../../../../../docs/adr/0033-the-screen-taxonomy.md)).
 *
 * The sale itself is neither: it is the till, an Asistente, and it has no entity
 * of its own in this domain at all.
 *
 * `permission` is not a member. It is `permissionForEntity(…, 'read')`, derived
 * from the entity's own `@entity({ domain, key })` — a hand-written domain
 * string here could name a domain the route behind it does not check.
 */
export interface SalesSurface<TEntity extends Entity = Entity> {
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
  readonly basePath: string;
  readonly icon: string;
  /** Shell-namespaced nav copy. `app:` keys are lint-restricted to `apps/`. */
  readonly navLabelKey: string;
  /**
   * ⚠️ `name`, and it is the only member that can be one:
   * `defineRecordSearchSource` refuses a label member that is not sortable,
   * filterable **and** a string at module load, and a channel's other two
   * members are enums.
   */
  readonly searchProperty: string;
  readonly labelProperty: string;
  readonly sublabelProperty?: string;
}

/** The `read` permission guarding a surface, derived from its entity. */
export const permissionForSalesSurface = (surface: SalesSurface): Permission =>
  permissionForEntity(surface.entityConstructor, 'read');

/** The workspace tab address for a surface's list, and for one of its records. */
export const salesListAddress = (surface: SalesSurface): string =>
  screenAddress({ type: 'master', key: surface.entityKey });

export const salesRecordAddress = (
  surface: SalesSurface,
  id: string,
): string => screenAddress({ type: 'master', key: surface.entityKey, id });

type SalesSurfaceDeclaration<TEntity extends Entity> = Omit<
  SalesSurface<TEntity>,
  'entityConstructor' | 'entityKey' | 'entityPluralKey'
> & { readonly entityKey: EntityCatalogKey };

/**
 * Declare a surface, reading off the decorator what the decorator already knows.
 *
 * `pluralKey` is optional on `MetaEntityOptions`, so an entity that never
 * declared one fails here — at module load, where the surface is declared —
 * rather than by titling a search group `undefined` on the first keystroke.
 */
export const salesSurface = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  declaration: SalesSurfaceDeclaration<TEntity>,
): SalesSurface<TEntity> => {
  const { pluralKey } = extractMetaEntity(entityConstructor);
  if (pluralKey === undefined) {
    throw new EntifixBuildError(
      `${entityConstructor.name} must declare pluralKey on @entity() to be a sales surface`,
    );
  }
  return { ...declaration, entityConstructor, entityPluralKey: pluralKey };
};

export const SALES_CHANNEL_SURFACE = salesSurface(SalesChannel, {
  entityKey: 'sales-channel',
  basePath: '/sales/sales-channel',
  icon: '⌗',
  navLabelKey: 'shell:sales.nav.channels',
  searchProperty: 'name',
  labelProperty: 'name',
  sublabelProperty: 'type',
});

/** Every sales surface this shell contributes, in the order they appear. */
export const SALES_SURFACES: readonly SalesSurface[] = [SALES_CHANNEL_SURFACE];

/**
 * The till, which is not a `SalesSurface` and could not be one.
 *
 * A surface is an entity's list and record pages; the till is a guided flow over
 * records three other services own, and it writes no `sales` row at all. It is
 * addressed `wizard:` for that reason — the address is the taxonomy serialized,
 * and calling this `master:` would be a lie the registry then had to keep
 * ([ADR 0042](../../../../../docs/adr/0042-the-workspace-address-is-the-taxonomy-serialized.md)).
 */
export const COUNTER_SALE_SURFACE = {
  key: 'counter-sale',
  basePath: '/sales/counter-sale',
  icon: '⌸',
  navLabelKey: 'shell:sales.nav.counterSale',
  /**
   * ⚠️ The **verb**, not `sales-channel:read`. Seeing which counters exist and
   * being allowed to take money through one are different authorities, which is
   * the whole reason the verb was declared (ADR 0056).
   */
} as const;
