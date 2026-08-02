import { cookies } from 'next/headers';

import { CART_COOKIE, type CartLine, parseCart } from './cart-state';

/**
 * The cart as this request sees it.
 *
 * Server-only, because `cookies()` is: reading it marks the calling route
 * dynamic. That is the trade `/cart` makes on purpose — the first response
 * already contains the visitor's items, instead of an empty cart that corrects
 * itself after hydration.
 */
export async function readCart(): Promise<CartLine[]> {
  return parseCart((await cookies()).get(CART_COOKIE)?.value);
}
