import {
  defineRecordSearchSource,
  type RecordSearchSource,
} from '@r10c/shells-next-common/server';

import {
  AGREEMENT_SURFACE,
  COMMISSION_ENTRY_SURFACE,
  type SettlementSurface,
  VENDOR_PAYOUT_SURFACE,
} from '../settlement-surfaces';
import { SETTLEMENT_SERVICE_URL } from './service-urls';

/**
 * The settlement records, as sources the palette can search (ADR 0040).
 *
 * They live beside the screens rather than in the base shell, for the reason the
 * catalog's do: a base shell naming every domain would hand a second host
 * sources for screens it does not mount. The `href`s are built from the very
 * `basePath` the screens are generated at, so a result cannot route to a page
 * this host does not serve.
 *
 * ⚠️ **Every source searches and labels by `vendorId`**, and until this change
 * none of them could. `defineRecordSearchSource` refuses a label member that is
 * not sortable, filterable and a string, **at module load** — and every string
 * member across these entities was filterable and not sortable, so the
 * declaration below would have thrown as the module loaded, taking the whole
 * back office with it. `vendorId` gained `sortable: true` for this and for the
 * scope predicate, which want the same member for the same reason: it is what
 * identifies whose record this is.
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
    labelProperty: surface.labelProperty,
    sublabelProperty: surface.sublabelProperty,
    labelKey: surface.entityPluralKey,
    href: id => `${surface.basePath}/${id}`,
  });

export const SETTLEMENT_SEARCH_SOURCES: readonly RecordSearchSource[] =
  SEARCHABLE.map(searchSourceFor);
