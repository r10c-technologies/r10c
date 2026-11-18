/**
 * A query string from whatever a page carries — empty when there is nothing to
 * carry, so a bare path stays bare.
 */
const queryOf = (extra: Readonly<Record<string, string>>) => {
  const query = new URLSearchParams(Object.entries(extra)).toString();
  return query === '' ? '' : `?${query}`;
};

/**
 * Every internal path the storefront can produce, in one place.
 *
 * Locale-free on purpose: `StoreLink` applies the prefix. A component that
 * builds a path by hand is the one that will eventually ship an unprefixed
 * href, which still works — the proxy redirects — but costs the visitor a
 * round trip and can land them in a different language than the page they came
 * from.
 */
export const storePaths = {
  home: () => '/',
  category: (code: string) => `/c/${code}`,
  /**
   * A published offering, addressed by its **offering id**.
   *
   * Not its `code`: offering and specification are 1:N by construction, so two
   * vendors publishing against one specification produce the same code and
   * `/p/<code>` collides — and a lookup by code returns the *first* match
   * rather than failing, which makes the second vendor's listing silently
   * unreachable instead of visibly broken (ADR 0049).
   */
  offering: (offeringId: string) => `/p/${offeringId}`,
  search: (term?: string) =>
    term ? `/search?q=${encodeURIComponent(term)}` : '/search',
  /** The cart, with whatever the page reads, such as an action's notice. */
  cart: (extra: Readonly<Record<string, string>> = {}) =>
    `/cart${queryOf(extra)}`,
  /**
   * The review step between the cart and the checkout, where the buyer also
   * chooses how to pay each seller (ADR 0076 §7) — so nothing about tenders
   * travels on the way here.
   */
  checkoutReview: (extra: Readonly<Record<string, string>> = {}) =>
    `/cart/review${queryOf(extra)}`,
  /**
   * Where a buyer waits on their checkout and then reads its receipt.
   *
   * ⚠️ **The flow id is not a capability.** The page renders nothing about a
   * flow without the flow ticket and the receipt in this browser's `httpOnly`
   * cookies, so a guessed or shared address shows a stranger nothing.
   */
  orderStatus: (flowId: string) =>
    `/order/status/${encodeURIComponent(flowId)}`,
} as const;
