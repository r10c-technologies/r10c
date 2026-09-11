import type { Locale } from '@r10c/entifix-ts-i18n/routing';

import type { Receipt } from './receipt-state';

/**
 * The time the cancel window closes, formatted for the buyer — or `undefined`
 * when there is no window to offer.
 *
 * ⚠️ **Three conditions and a clock, all checked before anything is drawn.**
 * `receipt-state.ts` states the rule this implements: a page offers the cancel
 * only when the capability is present and the window is open, rather than
 * rendering a button and discovering the answer from a `401`. The nonce is
 * absent on a counter sale and on any checkout predating the capability; the
 * window is absent with it; and an order already cancelled from this browser
 * has nothing left to offer
 * ([ADR 0058](../../../../../../docs/adr/0058-the-order-after-payment.md) §5).
 *
 * It lives here rather than in the page for two reasons that agree: everything
 * it reads comes out of the cookie module beside it, and a page is a server
 * component this workspace's runner cannot render — so a rule left inside one
 * is a rule nothing checks.
 *
 * ⚠️ **The label is a time, not a countdown.** A relative "in 28 minutes"
 * rendered on the server is wrong the moment the page is left open, and this
 * page is one a buyer leaves open.
 */
export const cancelWindowLabel = (
  locale: Locale,
  receipt: Receipt,
  now: Date,
): string | undefined => {
  if (receipt.cancelled === true) return undefined;
  if (!receipt.cancelNonce) return undefined;
  if (receipt.cancelWindowEndsAt === undefined) return undefined;

  const endsAt = new Date(receipt.cancelWindowEndsAt);
  // An unparseable stamp closes the window rather than opening one forever.
  // Everything in the cookie is untrusted, and a `NaN` compares false against
  // every bound — so the check has to be explicit rather than implied by the
  // comparison below it.
  if (Number.isNaN(endsAt.getTime())) return undefined;
  if (endsAt.getTime() <= now.getTime()) return undefined;

  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(endsAt);
};
