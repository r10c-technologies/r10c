'use client';

import type { EntityCrudListView } from '@entifix/next-shell';
import { createContext, type ReactNode, useContext } from 'react';

import {
  AGREEMENT_SURFACE,
  COMMISSION_ENTRY_SURFACE,
  VENDOR_PAYOUT_SURFACE,
} from '../settlement-surfaces';

/**
 * How a vendor reads their own statement (#559).
 *
 * Every row a vendor is served is theirs — settlement-service narrows each
 * read to the caller — so a "Vendedor" column would repeat their own name on
 * every line, and "Pagos a vendedores" would title a list that holds one
 * vendor's payouts. The vendor gets the sidebar's own `_vendor` words over a
 * list without the column; an operator, reading across vendors, gets both.
 *
 * ⚠️ **Copy and presentation, never access.** The party role is routing context
 * (ADR 0015): what a reader may read is decided by the service, and a column
 * withheld here is one whose value the service still sends.
 */
const VENDOR_VIEWS: Readonly<Record<string, EntityCrudListView>> = {
  [AGREEMENT_SURFACE.entityKey]: {
    titleKey: 'r10c:settlement.nav.agreements_vendor',
    hiddenColumns: ['vendorId'],
  },
  [COMMISSION_ENTRY_SURFACE.entityKey]: {
    titleKey: 'r10c:settlement.nav.entries_vendor',
    hiddenColumns: ['vendorId'],
  },
  [VENDOR_PAYOUT_SURFACE.entityKey]: {
    titleKey: 'r10c:settlement.nav.payouts_vendor',
    hiddenColumns: ['vendorId'],
  },
};

const OPERATOR_VIEW: EntityCrudListView = {};

/**
 * One settlement list as `partyRole` reads it.
 *
 * Plain rather than a hook, because a host titles a workspace tab outside
 * React — the tab registry is built once per reader, not rendered — and the
 * tab must say exactly what the page inside it says.
 */
export const settlementListView = (
  entityKey: string,
  partyRole: string | undefined,
): EntityCrudListView =>
  partyRole === 'vendor'
    ? (VENDOR_VIEWS[entityKey] ?? OPERATOR_VIEW)
    : OPERATOR_VIEW;

const SettlementReaderContext = createContext<string | undefined>(undefined);

/** The reader's party role, for the lists below it. Copy only (ADR 0015). */
export function SettlementReaderProvider({
  partyRole,
  children,
}: {
  partyRole: string | undefined;
  children: ReactNode;
}) {
  return (
    <SettlementReaderContext.Provider value={partyRole}>
      {children}
    </SettlementReaderContext.Provider>
  );
}

/** {@link settlementListView} for whoever the provider above says is reading. */
export const useSettlementListView = (entityKey: string): EntityCrudListView =>
  settlementListView(entityKey, useContext(SettlementReaderContext));
