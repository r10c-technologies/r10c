import { cartNoticeQuery } from './cart-notice';

/**
 * Where a card's add sends the buyer back to (#574): the listing it was
 * posted from, so building a basket from a search is not a trip to the cart
 * and back per item.
 *
 * The address arrives in a form field, so it is the buyer's to tamper with,
 * and a redirect to anywhere it names would be an open redirect (H5). Only a
 * path on this storefront, in the locale the form was posted in, is accepted:
 *
 * - it starts `/<locale>` and goes on with `/`, `?` or nothing;
 * - it never starts `//` or `/\`, which a browser reads as another host;
 * - it holds no backslash and no control character anywhere, which some
 *   parsers normalize into one of the above.
 *
 * Anything else is `undefined`, and the action falls back to the cart page,
 * exactly as it did before.
 */
export function safeReturn(
  returnTo: FormDataEntryValue | null,
  locale: string,
): string | undefined {
  if (typeof returnTo !== 'string' || locale.length === 0) return undefined;
  if (returnTo.startsWith('//') || /[\\\p{Cc}]/u.test(returnTo)) {
    return undefined;
  }
  const prefix = `/${locale}`;
  if (!returnTo.startsWith(prefix)) return undefined;
  const rest = returnTo.slice(prefix.length);
  return rest === '' || rest.startsWith('/') || rest.startsWith('?')
    ? returnTo
    : undefined;
}

/**
 * `path` with the add's notice on it, replacing any notice an earlier add left
 * there, so adding twice from one listing never stacks two.
 */
export function withAddedNotice(path: string, offeringId: string): string {
  const at = path.indexOf('?');
  const pathname = at === -1 ? path : path.slice(0, at);
  const query = new URLSearchParams(at === -1 ? '' : path.slice(at + 1));
  query.delete('added');
  query.delete('removed');
  query.delete('quantity');
  const kept = query.toString();
  const notice = cartNoticeQuery({ kind: 'added', offeringId });
  return `${pathname}?${kept === '' ? notice : `${kept}&${notice}`}`;
}
