/**
 * The tender a buyer picked for each seller, by vendor id, as it travels
 * between the cart and the review step. Raw: `tenderOf` narrows it where it is
 * used.
 */
export type TenderChoice = Readonly<Record<string, string>>;

/** The query-string prefix a seller's tender travels under, `method:<id>`. */
export const TENDER_PREFIX = 'method:';

/**
 * A query string from the tenders and anything else a page carries — empty
 * when there is nothing to carry, so a bare path stays bare.
 */
const queryOf = (
  tenders: TenderChoice,
  extra: Readonly<Record<string, string>>,
) => {
  const query = new URLSearchParams([
    ...Object.entries(tenders).map(([vendorId, tender]) => [
      `${TENDER_PREFIX}${vendorId}`,
      tender,
    ]),
    ...Object.entries(extra),
  ]).toString();
  return query === '' ? '' : `?${query}`;
};

/**
 * The tenders a query string carries — every `method:<vendorId>` parameter,
 * first value wins. Anything else on the query is ignored.
 */
export const parseTenderChoice = (
  query: Readonly<Record<string, string | string[] | undefined>> | undefined,
): TenderChoice =>
  Object.fromEntries(
    Object.entries(query ?? {}).flatMap(([key, value]) => {
      const first = Array.isArray(value) ? value[0] : value;
      return key.startsWith(TENDER_PREFIX) && first !== undefined
        ? [[key.slice(TENDER_PREFIX.length), first]]
        : [];
    }),
  );

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
  /**
   * The cart, optionally with the tenders already chosen for each seller —
   * the review step's way back — and whatever else the page reads, such as
   * an action's notice. Every cart action carries the tenders it was posted
   * with, so editing the cart never resets a seller's payment choice.
   */
  cart: (
    tenders: TenderChoice = {},
    extra: Readonly<Record<string, string>> = {},
  ) => `/cart${queryOf(tenders, extra)}`,
  /**
   * The review step between the cart and the checkout. The cart's `GET` form
   * lands here with a tender per seller on the query string.
   */
  checkoutReview: (
    tenders: TenderChoice = {},
    extra: Readonly<Record<string, string>> = {},
  ) => `/cart/review${queryOf(tenders, extra)}`,
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
