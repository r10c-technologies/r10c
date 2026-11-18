import { OrderFindPage } from '@r10c/shells-next-marketplace/server';
import type { Metadata } from 'next';

import { requireLocale } from '../../../locale-param';

/**
 * Where "find my order" answers — the same page whatever matched, so it says
 * nothing about which orders or emails exist (ADR 0076 §6). Static, like the
 * form, so it reads with scripting off.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function OrderFindSentRoute({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  return <OrderFindPage locale={await requireLocale(params)} sent />;
}
