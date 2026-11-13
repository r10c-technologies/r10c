'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { parseTenderChoice, storePaths } from '../routing/paths';
import { type CartNotice, cartNoticeQuery } from './cart-notice';
import {
  CART_COOKIE,
  type CartLine,
  parseCart,
  serializeCart,
  withAdded,
  withQuantity,
} from './cart-state';

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

/** The tenders a cart form was posted with: its `method:<vendorId>` fields. */
const tendersOf = (formData: FormData) =>
  parseTenderChoice(
    Object.fromEntries(
      Array.from(formData.entries(), ([key, value]) => [key, String(value)]),
    ),
  );

/**
 * The cart page, carrying what the action did for its status region and the
 * tenders the buyer had chosen, so a removal or its undo never resets a
 * seller's payment choice.
 */
const cartWith = (locale: string, formData: FormData, notice?: CartNotice) =>
  `/${locale}${storePaths.cart(
    tendersOf(formData),
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

/**
 * Adds the units asked for (one, unless the form says otherwise), then sends
 * the visitor to the cart.
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
  const locale = String(formData.get('locale') ?? '');
  if (!offeringId) return;

  // The product page's buy box sends a quantity; a card's form sends none
  // and adds one.
  const quantity = Number(formData.get('quantity') ?? 1);

  const store = await cookies();
  await writeCart(
    withAdded(parseCart(store.get(CART_COOKIE)?.value), offeringId, quantity),
  );

  // `redirect` throws to unwind the action, so it must come after the write.
  if (locale)
    redirect(cartWith(locale, formData, { kind: 'added', offeringId }));
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
      cartWith(locale, formData, {
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

  const store = await cookies();
  await writeCart(
    withAdded(
      parseCart(store.get(CART_COOKIE)?.value),
      offeringId,
      Number(formData.get('quantity') ?? 1),
    ),
  );

  if (locale) redirect(cartWith(locale, formData));
}

/**
 * Sets one line's quantity from the cart's own number field. Zero removes the
 * line; the rules are `withQuantity`'s.
 */
export async function setQuantity(formData: FormData) {
  const offeringId = String(formData.get('offeringId') ?? '');
  if (!offeringId) return;

  const store = await cookies();
  await writeCart(
    withQuantity(
      parseCart(store.get(CART_COOKIE)?.value),
      offeringId,
      Number(formData.get('quantity') ?? Number.NaN),
    ),
  );
}
