import { OrderFindPage } from '@r10c/shells-next-marketplace/server';
import type { Metadata } from 'next';

import { requireLocale } from '../../locale-param';

/**
 * "Find my order": a number and an email, and a fresh access link mailed to
 * the address on file if they match (ADR 0076 §6). Reads nothing from the
 * request; the answer is its own page, `./sent`. It blocks rather than
 * streams (#730): the header's category links are a catalog read, and a
 * streamed hole would leave them hidden with scripting off, where the form
 * must work.
 */
export const instant = false;

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function OrderFindRoute({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  return <OrderFindPage locale={await requireLocale(params)} />;
}
