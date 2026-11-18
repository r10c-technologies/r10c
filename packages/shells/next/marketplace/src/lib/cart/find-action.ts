'use server';

import { redirect } from 'next/navigation';

import { storePaths } from '../routing/paths';
import { orderLookupToken, orderServiceUrl } from './checkout-config';

/**
 * "Find my order" (ADR 0076 §6): hand a number and an email to order-service,
 * with the storefront's own crossing token, and answer the buyer the same
 * whatever happened — matched, not matched, too soon, unreachable — so the
 * page is never an oracle for which orders or emails exist. A link only ever
 * goes to the email on file.
 */
export async function findOrder(formData: FormData): Promise<void> {
  const locale = String(formData.get('locale') ?? '');
  await fetch(`${orderServiceUrl()}/checkout-group/send-access-link`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-crossing-token': orderLookupToken(),
    },
    body: JSON.stringify({
      number: String(formData.get('number') ?? ''),
      email: String(formData.get('email') ?? ''),
    }),
    cache: 'no-store',
  }).catch(() => undefined);
  redirect(`/${locale}${storePaths.orderFindSent()}`);
}
