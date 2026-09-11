import {
  type Permission,
  permissionForEntity,
  screenAddress,
  type ScreenType,
} from '@r10c/business-ts-authz';
import {
  Agreement,
  CommissionEntry,
  SettlementRun,
  VendorPayout,
} from '@r10c/business-ts-settlement-management';
import type { Entity, EntityConstructor } from '@r10c/entifix-ts-core';
import { EntifixBuildError, extractMetaEntity } from '@r10c/entifix-ts-core';
import type { EntityCatalogKey } from '@r10c/shells-next-common';

/**
 * One settlement screen, declared once, for everything that has to name it.
 *
 * ⚠️ **The screen type is a member here, and this is the first shell where it
 * has to be.** `shells-next-sales` hard-codes `master` and `shells-next-stock`
 * hard-codes `operation`, because every screen each of them contributes is the
 * same kind. This domain spans both, and by ADR 0033's own test rather than by
 * preference:
 *
 * - An `Agreement` is **Definiciones**. Somebody authors it and every settled
 *   sale then references it — the shape the taxonomy names, and the same shape a
 *   `SalesChannel` has.
 * - A `CommissionEntry`, a `SettlementRun` and a `VendorPayout` are
 *   **Operaciones**. A process made every one of them: a captured sale writes
 *   the entry, a sweep opens the run, the run folds the payout. Not one is a
 *   thing you define and then reference.
 *
 * Hard-coding either would have put three records under a heading that says a
 * person wrote them, or an agreement under one that says a process did.
 *
 * `permission` is **not** a member. It is `permissionForEntity(…, 'read')`,
 * derived from the entity's own `@entity({ domain, key })`, which is the whole
 * point of the `<domain>:<entityKey>:<action>` shape — a hand-written domain
 * string here could name a domain the route behind it does not check.
 */
export interface SettlementSurface<TEntity extends Entity = Entity> {
  readonly entityConstructor: EntityConstructor<TEntity>;
  /**
   * `@entity({ key })`, stated rather than derived.
   *
   * Typed as {@link EntityCatalogKey}, so an entity whose catalog copy is
   * missing cannot be declared here at all; `makeEntityCrud` then re-reads the
   * decorator and throws if the two disagree, which is the check that survives a
   * rename of one and not the other.
   */
  readonly entityKey: EntityCatalogKey;
  /** `@entity({ pluralKey })` — the search group's heading. */
  readonly entityPluralKey: string;
  /** Which tier of the taxonomy this screen belongs to. See the note above. */
  readonly screenType: ScreenType;
  readonly basePath: string;
  readonly icon: string;
  /** Shell-namespaced nav copy. `app:` keys are lint-restricted to `apps/`. */
  readonly navLabelKey: string;
  /**
   * ⚠️ **`vendorId` on all four, and it took a metadata change to be able to say
   * so.** `defineRecordSearchSource` refuses a label member that is not
   * simultaneously a string, filterable **and** sortable, at module load. Every
   * string member across these entities was filterable and not sortable, so
   * until `vendorId` gained `sortable: true` no settlement entity could name one
   * of its own records at all.
   */
  readonly searchProperty: string;
  readonly labelProperty: string;
  readonly sublabelProperty?: string;
}

/** The `read` permission guarding a surface, derived from its entity. */
export const permissionForSettlementSurface = (
  surface: SettlementSurface,
): Permission => permissionForEntity(surface.entityConstructor, 'read');

/**
 * The workspace tab address for a surface's list, and for one of its records.
 *
 * The address is the taxonomy serialized, so it takes the surface's own screen
 * type rather than a constant — addressing an Operaciones screen `master:` would
 * be a lie the registry then had to keep
 * ([ADR 0042](../../../../../docs/adr/0042-the-workspace-address-is-the-taxonomy-serialized.md)).
 */
export const settlementListAddress = (surface: SettlementSurface): string =>
  screenAddress({ type: surface.screenType, key: surface.entityKey });

export const settlementRecordAddress = (
  surface: SettlementSurface,
  id: string,
): string =>
  screenAddress({ type: surface.screenType, key: surface.entityKey, id });

type SettlementSurfaceDeclaration<TEntity extends Entity> = Omit<
  SettlementSurface<TEntity>,
  'entityConstructor' | 'entityKey' | 'entityPluralKey'
> & { readonly entityKey: EntityCatalogKey };

/**
 * Declare a surface, reading off the decorator what the decorator already knows.
 *
 * `pluralKey` is optional on `MetaEntityOptions`, so an entity that never
 * declared one fails here — at module load, where the surface is declared —
 * rather than by titling a search group `undefined` on the first keystroke.
 */
export const settlementSurface = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  declaration: SettlementSurfaceDeclaration<TEntity>,
): SettlementSurface<TEntity> => {
  const { pluralKey } = extractMetaEntity(entityConstructor);
  if (pluralKey === undefined) {
    throw new EntifixBuildError(
      `${entityConstructor.name} must declare pluralKey on @entity() to be a settlement surface`,
    );
  }
  return { ...declaration, entityConstructor, entityPluralKey: pluralKey };
};

export const AGREEMENT_SURFACE = settlementSurface(Agreement, {
  entityKey: 'agreement',
  screenType: 'master',
  basePath: '/settlement/agreement',
  icon: '⚖',
  navLabelKey: 'shell:settlement.nav.agreements',
  searchProperty: 'vendorId',
  labelProperty: 'vendorId',
});

export const COMMISSION_ENTRY_SURFACE = settlementSurface(CommissionEntry, {
  entityKey: 'commission-entry',
  screenType: 'operation',
  basePath: '/settlement/commission-entry',
  icon: '≡',
  navLabelKey: 'shell:settlement.nav.entries',
  searchProperty: 'vendorId',
  labelProperty: 'vendorId',
  sublabelProperty: 'currency',
});

export const SETTLEMENT_RUN_SURFACE = settlementSurface(SettlementRun, {
  entityKey: 'settlement-run',
  screenType: 'operation',
  basePath: '/settlement/settlement-run',
  icon: '⏱',
  navLabelKey: 'shell:settlement.nav.runs',
  // ⚠️ A run has **no** string member at all — a period, a period and a status.
  // `searchProperty` is declared for the surface's shape and this surface is
  // deliberately left out of `SETTLEMENT_SEARCH_SOURCES`: an entity with nothing
  // nameable should contribute no search source rather than a source that names
  // its records by a date.
  searchProperty: 'status',
  labelProperty: 'status',
});

export const VENDOR_PAYOUT_SURFACE = settlementSurface(VendorPayout, {
  entityKey: 'vendor-payout',
  screenType: 'operation',
  basePath: '/settlement/vendor-payout',
  icon: '◧',
  navLabelKey: 'shell:settlement.nav.payouts',
  searchProperty: 'vendorId',
  labelProperty: 'vendorId',
  sublabelProperty: 'currency',
});

/** The one Definiciones screen this shell contributes. */
export const SETTLEMENT_MASTER_SURFACES: readonly SettlementSurface[] = [
  AGREEMENT_SURFACE,
];

/**
 * The Operaciones screens.
 *
 * `CommissionEntry` is here although no person writes one, for the reason
 * `Reservation` is on the stock side: the ledger is what a vendor's answer to
 * "why is my payout this number?" is made of, and a fold nobody can inspect is a
 * fold nobody can check.
 */
export const SETTLEMENT_OPERATION_SURFACES: readonly SettlementSurface[] = [
  COMMISSION_ENTRY_SURFACE,
  SETTLEMENT_RUN_SURFACE,
  VENDOR_PAYOUT_SURFACE,
];

export const SETTLEMENT_SURFACES: readonly SettlementSurface[] = [
  ...SETTLEMENT_MASTER_SURFACES,
  ...SETTLEMENT_OPERATION_SURFACES,
];
