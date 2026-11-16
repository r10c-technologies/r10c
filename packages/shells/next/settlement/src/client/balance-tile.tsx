'use client';

import { LocaleLink } from '@entifix/next-shell';
import { SummaryTile, useTranslateKey } from '@entifix/react-controls';
import type { VendorBalance } from '@r10c/business-ts-settlement-management';
import { useCallback, useEffect, useState } from 'react';

import { VENDOR_PAYOUT_SURFACE } from '../settlement-surfaces';
import { useSettlementAdapters } from './settlement-context';

type BalanceRead =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly balance: VendorBalance }
  | { readonly state: 'failed' };

/**
 * The balance, read on mount, on Retry and whenever the window regains focus.
 *
 * ⚠️ **Never pushed.** Settlement publishes nothing (ADR 0068), so no event
 * tells an open tab its balance moved; focus is the moment a vendor coming
 * back to the tab would look at it.
 */
function useVendorBalance(read: () => Promise<VendorBalance>) {
  const [result, setResult] = useState<BalanceRead>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    read().then(
      balance => {
        if (live) setResult({ state: 'ready', balance });
      },
      () => {
        if (live) setResult({ state: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [read, attempt]);

  useEffect(() => {
    const again = () => setAttempt(count => count + 1);
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, []);

  const retry = useCallback(() => {
    setResult({ state: 'loading' });
    setAttempt(count => count + 1);
  }, []);

  return { result, retry };
}

/**
 * The vendor home's balance tile (#563, ADR 0077): what the next settlement
 * run will pay them, one activation from "Mis pagos".
 *
 * It is the service's own fold (`payoutFor`), never summed here, so it cannot
 * disagree with the payout it predicts. An empty balance carries no currency,
 * so it reads as a count of nothing rather than as an amount in a currency
 * nobody stated.
 */
export function BalanceTile() {
  const translateKey = useTranslateKey();
  const { vendorBalance } = useSettlementAdapters();
  const { result, retry } = useVendorBalance(vendorBalance);

  const balance = result.state === 'ready' ? result.balance : undefined;
  return (
    <SummaryTile
      label={translateKey('r10c:settlement.home.balance')}
      href={VENDOR_PAYOUT_SURFACE.basePath}
      state={result.state}
      onRetry={retry}
      {...(balance?.currency === undefined
        ? { count: balance?.amount }
        : {
            money: {
              amount: balance.amount,
              currency: balance.currency,
              unit: 'minor' as const,
            },
          })}
      renderLink={({ href, className, children }) => (
        <LocaleLink href={href} className={className}>
          {children}
        </LocaleLink>
      )}
    />
  );
}
