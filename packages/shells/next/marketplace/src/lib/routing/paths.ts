/**
 * Every internal path the storefront can produce, in one place.
 *
 * Locale-free on purpose: `StoreLink` applies the prefix. A component that
 * builds a path by hand is the one that will eventually ship an unprefixed
 * href, which still works — the middleware redirects — but costs the visitor a
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
  cart: () => '/cart',
} as const;
