import {
  isCancelOutcome,
  OrderStatusPage,
} from '@r10c/shells-next-marketplace/server';

import { requireLocale } from '../../../locale-param';

/**
 * Where a buyer waits on their checkout and reads its receipt. `searchParams`
 * carries what a cancel attempt did, for exactly one navigation; the receipt
 * and the flow ticket are the page's only state, both `httpOnly` cookies.
 */
export default async function OrderStatusRoute({
  params,
  searchParams,
}: {
  readonly params: Promise<{
    readonly locale: string;
    readonly flowId: string;
  }>;
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
}) {
  const { flowId } = await params;
  const query = await searchParams;
  const raw = query?.['cancel'];
  const outcome = typeof raw === 'string' ? raw : undefined;

  return (
    <OrderStatusPage
      locale={await requireLocale(params)}
      flowId={decodeURIComponent(flowId)}
      // Narrowed against the closed set: the value decides a translation key.
      outcome={isCancelOutcome(outcome) ? outcome : undefined}
    />
  );
}
