'use client';

import {
  Agreement,
  CommissionEntry,
  SettlementRun,
  VendorPayout,
} from '@r10c/business-ts-settlement-management';
import { makeEntityMetadataSource } from '@r10c/entifix-ts-rest-client';
import type { EntityCrud } from '@r10c/shells-next-common';
import { makeEntityCrud } from '@r10c/shells-next-common';

import {
  AGREEMENT_SURFACE,
  COMMISSION_ENTRY_SURFACE,
  SETTLEMENT_RUN_SURFACE,
  VENDOR_PAYOUT_SURFACE,
} from '../settlement-surfaces';
import { AgreementSingleViewClientPage } from './agreement-single-view';
import { useSettlementAdapters } from './settlement-context';

/**
 * Where each screen reads this caller's affordances (ADR 0026).
 *
 * The **proxy** path, not the service's own: the browser reaches settlement
 * through the host's same-origin proxy, which is what carries the httpOnly
 * session cookie upstream. Aimed at the backend directly it would answer `401`,
 * and every screen would fall back to its pre-descriptor behaviour — offering
 * Save on records no role may write.
 */
export const SETTLEMENT_METADATA = makeEntityMetadataSource({
  url: name => `/api/settlement/${name}/$metadata`,
});

/**
 * The three generated screens.
 *
 * ⚠️ **None of them declares a read-only flag, and none should.** No role holds
 * a write on a commission entry, a run or a payout — a fold produces all three
 * and nobody authors them — so the served descriptor withholds Save on its own.
 * Read-only is a fact the server states, never one a screen sets
 * ([ADR 0033](../../../../../docs/adr/0033-the-screen-taxonomy.md)).
 */
export const commissionEntryCrud: EntityCrud<CommissionEntry> = makeEntityCrud(
  CommissionEntry,
  {
    useAdapters: useSettlementAdapters,
    basePath: COMMISSION_ENTRY_SURFACE.basePath,
    catalogKey: COMMISSION_ENTRY_SURFACE.entityKey,
    repository: 'commissionEntryRest',
    configuration: 'configurationStore',
    hiddenFields: ['id'],
    metadataSource: SETTLEMENT_METADATA,
  },
);

export const settlementRunCrud: EntityCrud<SettlementRun> = makeEntityCrud(
  SettlementRun,
  {
    useAdapters: useSettlementAdapters,
    basePath: SETTLEMENT_RUN_SURFACE.basePath,
    catalogKey: SETTLEMENT_RUN_SURFACE.entityKey,
    repository: 'settlementRunRest',
    configuration: 'configurationStore',
    hiddenFields: ['id'],
    metadataSource: SETTLEMENT_METADATA,
  },
);

export const vendorPayoutCrud: EntityCrud<VendorPayout> = makeEntityCrud(
  VendorPayout,
  {
    useAdapters: useSettlementAdapters,
    basePath: VENDOR_PAYOUT_SURFACE.basePath,
    catalogKey: VENDOR_PAYOUT_SURFACE.entityKey,
    repository: 'vendorPayoutRest',
    configuration: 'configurationStore',
    hiddenFields: ['id'],
    metadataSource: SETTLEMENT_METADATA,
  },
);

/**
 * The agreement, whose **list is generated and whose record page is not**.
 *
 * The split is exactly as wide as it has to be. A list renders cells from
 * metadata and a map member is simply a column nobody reads; a form renders
 * *inputs*, and there is no input for a map. So `makeEntityCrud` supplies
 * `ListPage` and {@link AgreementSingleViewClientPage} replaces `SingleViewPage`
 * — and the workspace registry, which spreads a crud's two pages into a tab
 * kind, needs no special case for it.
 */
const generatedAgreementCrud = makeEntityCrud(Agreement, {
  useAdapters: useSettlementAdapters,
  basePath: AGREEMENT_SURFACE.basePath,
  catalogKey: AGREEMENT_SURFACE.entityKey,
  repository: 'agreementRest',
  configuration: 'configurationStore',
  // The rate map is a column the table renders as an object. Hiding it from the
  // list is cosmetic rather than load-bearing — unlike hiding it from the form,
  // which stops a save writing `NaN` over it.
  hiddenFields: ['id', 'channelCommissionBasisPoints'],
  metadataSource: SETTLEMENT_METADATA,
});

export const agreementCrud: EntityCrud<Agreement> = {
  ...generatedAgreementCrud,
  SingleViewPage: AgreementSingleViewClientPage,
};

/** Definiciones, and Operaciones — the two tiers this shell contributes. */
export const SETTLEMENT_MASTER_CRUDS = [agreementCrud] as const;

export const SETTLEMENT_OPERATION_CRUDS = [
  commissionEntryCrud,
  settlementRunCrud,
  vendorPayoutCrud,
] as const;

export const AgreementListClientPage = agreementCrud.ListPage;
export const AgreementSingleViewPage = agreementCrud.SingleViewPage;
export const CommissionEntryListClientPage = commissionEntryCrud.ListPage;
export const CommissionEntrySingleViewClientPage =
  commissionEntryCrud.SingleViewPage;
export const SettlementRunListClientPage = settlementRunCrud.ListPage;
export const SettlementRunSingleViewClientPage =
  settlementRunCrud.SingleViewPage;
export const VendorPayoutListClientPage = vendorPayoutCrud.ListPage;
export const VendorPayoutSingleViewClientPage = vendorPayoutCrud.SingleViewPage;
