'use server';

import { isLocale, type Locale } from '@entifix/core';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { getOffering } from '@r10c/implementation-marketplace-catalog-next';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { runRead } from '../catalog/catalog-reads';
import { storePaths } from '../routing/paths';
import { type CartNotice, cartNoticeQuery } from './cart-notice';
import { addedLine, type CartDecision, setLine } from './cart-quantity';
import {
  CART_COOKIE,
  type CartLine,
  parseCart,
  serializeCart,
  withLine,
  withQuantity,
} from './cart-state';
import { safeReturn, withAddedNotice } from './return-to';

/**
 * Cart mutations, as Server Actions.
 *
 * A form posting to one of these works with JavaScript disabled and needs no
 * client-side state library, no optimistic store and no fetch wrapper — the
 * browser posts, the server writes the cookie, `revalidatePath` re-renders the
 * affected routes, and the response carries the new markup.
 *
 * The cookie is `httpOnly: false` deliberately: the header's cart badge is a
 * client island that reads it to render a count without a round trip. It holds
 * no secret — item codes and quantities the visitor chose themselves — so
 * there is nothing to protect from a script that is already running on the
 * page. `sameSite: 'lax'` still keeps it off cross-site requests.
 */

const ONE_MONTH = 60 * 60 * 24 * 30;

/** The cart page, carrying what the action did for its status region. */
const cartWith = (locale: string, notice?: CartNotice) =>
  `/${locale}${storePaths.cart(
    notice === undefined
      ? {}
      : Object.fromEntries(new URLSearchParams(cartNoticeQuery(notice))),
  )}`;

async function writeCart(lines: readonly CartLine[]) {
  (await cookies()).set(CART_COOKIE, serializeCart(lines), {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    maxAge: ONE_MONTH,
  });

  // The cart page renders from the cookie, so it has to be rebuilt. The static
  // catalog routes do not depend on it — their badge hydrates client-side —
  // which is exactly why they can stay prerendered.
  revalidatePath('/[locale]/cart', 'page');
}

/** The published offering a line names, or `undefined` once it is gone. */
const publishedTerms = (offeringId: string) =>
  runRead(PublishedOffering, getOffering(offeringId), undefined);

/** The locale a form posted, narrowed: what its quantity was typed in. */
const postedLocale = (formData: FormData): Locale | undefined => {
  const locale = formData.get('locale');
  return isLocale(locale) ? locale : undefined;
};

/**
 * Back to the cart, saying which line was refused and why. A refusal writes
 * nothing: the cart keeps what it held, and the buyer is told rather than
 * sold a quantity they did not ask for (ADR 0082 §3).
 */
const refuse = (
  locale: Locale,
  offeringId: string,
  decision: Extract<CartDecision, { refusal: unknown }>,
): never =>
  redirect(
    cartWith(locale, {
      kind: 'refused',
      offeringId,
      refusal: decision.refusal,
    }),
  );

/**
 * Adds what the form asked for, read in the offering's unit, then sends the
 * visitor back to the listing the card was on, or to the cart. A card's form
 * asks for nothing: a new line starts at the offering's minimum, and one
 * already there grows by a step.
 *
 * The quantity is decided here, against the published terms rather than
 * whatever the page rendered (ADR 0082 §3): one the offering does not sell is
 * refused, and the cart says why. The checkout checks again.
 *
 * A card's form carries `returnTo`, the listing's own address (#574): building
 * a basket from a search is then one add after another rather than a trip to
 * the cart and back per item. The listing says what happened in a status
 * region (`AddedNotice`). An address that is not a path on this storefront is
 * ignored rather than followed (`safeReturn`), and the product page's buy box
 * sends none, so it still lands on the cart, the expected next step there.
 *
 * The redirect is not a flourish, it is the feedback. The header badge is a
 * client island that reads the cookie when it *mounts*, and a Server Action
 * leaves it mounted — so on a prerendered product page the count would sit
 * unchanged and the click would look like it did nothing. Navigating renders
 * the cart from the freshly written cookie, which is both unambiguous and the
 * behaviour a visitor with JavaScript disabled gets anyway.
 */
export async function addToCart(formData: FormData) {
  const offeringId = String(formData.get('offeringId') ?? '');
  const locale = postedLocale(formData);
  if (!offeringId || locale === undefined) return;

  const offering = await publishedTerms(offeringId);
  if (offering === undefined) redirect(cartWith(locale));

  const store = await cookies();
  const lines = parseCart(store.get(CART_COOKIE)?.value);
  const held = lines.find(line => line.offeringId === offeringId)?.quantity;
  const decision = addedLine(offering, held, formData.get('quantity'), locale);
  if ('refusal' in decision) refuse(locale, offeringId, decision);
  else await writeCart(withLine(lines, offeringId, decision.quantity));

  // `redirect` throws to unwind the action, so it must come after the write.
  const back = safeReturn(formData.get('returnTo'), locale);
  redirect(
    back === undefined
      ? cartWith(locale, { kind: 'added', offeringId })
      : withAddedNotice(back, offeringId),
  );
}

export async function removeFromCart(formData: FormData) {
  const offeringId = String(formData.get('offeringId') ?? '');
  const locale = String(formData.get('locale') ?? '');
  if (!offeringId) return;

  const store = await cookies();
  const lines = parseCart(store.get(CART_COOKIE)?.value);
  const removed = lines.find(line => line.offeringId === offeringId);

  await writeCart(lines.filter(line => line.offeringId !== offeringId));

  // The count goes with the notice: the cookie no longer has it, and Undo
  // gives back what was there rather than one.
  if (locale && removed)
    redirect(
      cartWith(locale, {
        kind: 'removed',
        offeringId,
        quantity: removed.quantity,
      }),
    );
}

/**
 * Undo for a removal: the line comes back with the count it had. An add rather
 * than a write of the old cart, so anything the buyer did since is kept, and a
 * line that came back some other way meanwhile is summed rather than lost.
 */
export async function restoreToCart(formData: FormData) {
  const offeringId = String(formData.get('offeringId') ?? '');
  const locale = String(formData.get('locale') ?? '');
  if (!offeringId) return;

  // The count the removal carried, in the scale the cookie held it in. Only a
  // positive whole number goes back, and the cart and the checkout check it
  // against the terms like any other line.
  const quantity = Number(formData.get('quantity'));
  const store = await cookies();
  const lines = parseCart(store.get(CART_COOKIE)?.value);
  const held = lines.find(line => line.offeringId === offeringId)?.quantity;
  await writeCart(withLine(lines, offeringId, (held ?? 0) + quantity));

  if (locale) redirect(cartWith(locale));
}

/**
 * Sets one line's quantity from the cart's own field, read in the offering's
 * unit and decided like an add. Zero removes the line; a quantity the
 * offering does not sell is refused and the cart says why.
 */
export async function setQuantity(formData: FormData) {
  const offeringId = String(formData.get('offeringId') ?? '');
  const locale = postedLocale(formData);
  if (!offeringId || locale === undefined) return;

  const offering = await publishedTerms(offeringId);
  const store = await cookies();
  const lines = parseCart(store.get(CART_COOKIE)?.value);
  // An offering unpublished since: the only change left is removing it.
  if (offering === undefined) {
    await writeCart(withQuantity(lines, offeringId, 0));
    redirect(cartWith(locale));
  }

  const decision = setLine(offering, formData.get('quantity'), locale);
  if ('refusal' in decision) refuse(locale, offeringId, decision);
  else await writeCart(withQuantity(lines, offeringId, decision.quantity));
}
