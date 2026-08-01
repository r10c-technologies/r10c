'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  CART_COOKIE,
  type CartLine,
  parseCart,
  serializeCart,
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
 * Adds one unit, then sends the visitor to the cart.
 *
 * The redirect is not a flourish, it is the feedback. The header badge is a
 * client island that reads the cookie when it *mounts*, and a Server Action
 * leaves it mounted — so on a prerendered product page the count would sit
 * unchanged and the click would look like it did nothing. Navigating renders
 * the cart from the freshly written cookie, which is both unambiguous and the
 * behaviour a visitor with JavaScript disabled gets anyway.
 */
export async function addToCart(formData: FormData) {
  const code = String(formData.get('code') ?? '');
  const locale = String(formData.get('locale') ?? '');
  if (!code) return;

  const store = await cookies();
  const lines = parseCart(store.get(CART_COOKIE)?.value);
  const existing = lines.find(line => line.code === code);

  await writeCart(
    existing
      ? lines.map(line =>
          line.code === code ? { ...line, quantity: line.quantity + 1 } : line,
        )
      : [...lines, { code, quantity: 1 }],
  );

  // `redirect` throws to unwind the action, so it must come after the write.
  if (locale) redirect(`/${locale}/cart`);
}

export async function removeFromCart(formData: FormData) {
  const code = String(formData.get('code') ?? '');
  if (!code) return;

  const store = await cookies();
  const lines = parseCart(store.get(CART_COOKIE)?.value);

  await writeCart(lines.filter(line => line.code !== code));
}
