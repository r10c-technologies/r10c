import {
  defineRecordSearchSource,
  type RecordSearchSource,
} from '@entifix/next-shell/server';
import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';

import {
  AGREEMENT_SURFACE,
  COMMISSION_ENTRY_SURFACE,
  type SettlementSurface,
  VENDOR_PAYOUT_SURFACE,
} from '../settlement-surfaces';
import {
  MARKETPLACE_SERVICE_URL,
  SETTLEMENT_SERVICE_URL,
} from './service-urls';

/**
 * The settlement records, as sources the palette can search (ADR 0040).
 *
 * They live beside the screens rather than in the base shell, for the reason the
 * catalog's do: a base shell naming every domain would hand a second host
 * sources for screens it does not mount. The `href`s are built from the very
 * `basePath` the screens are generated at, so a result cannot route to a page
 * this host does not serve.
 *
 * Each is searched **through the vendor** it belongs to (#552): the term is
 * matched against the vendor's display name in marketplace-service's
 * published-vendor projection, and the agreements, ledger lines and payouts
 * referring to the matches are listed under that name. `vendorId` is also the
 * scope predicate's member, so the records a vendor finds are their own.
 *
 * ⚠️ **`SettlementRun` contributes no source, deliberately.** It has no string
 * member at all — a period, a period and a status — so there is nothing to name
 * one by. A source labelling runs by their status would fill a palette with
 * results all called "Calculada", which is worse than the entity being
 * unsearchable.
 */
const SEARCHABLE: readonly SettlementSurface[] = [
  AGREEMENT_SURFACE,
  COMMISSION_ENTRY_SURFACE,
  VENDOR_PAYOUT_SURFACE,
];

const searchSourceFor = (surface: SettlementSurface): RecordSearchSource =>
  defineRecordSearchSource({
    entityConstructor: surface.entityConstructor,
    baseUrl: SETTLEMENT_SERVICE_URL,
    searchProperty: surface.searchProperty,
    sublabelProperty: surface.sublabelProperty,
    reference: {
      entityConstructor: PublishedVendor,
      baseUrl: MARKETPLACE_SERVICE_URL,
    },
    labelKey: surface.entityPluralKey,
    href: id => `${surface.basePath}/${id}`,
  });

export const SETTLEMENT_SEARCH_SOURCES: readonly RecordSearchSource[] =
  SEARCHABLE.map(searchSourceFor);
