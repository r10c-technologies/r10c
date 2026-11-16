'use client';

import { Text } from '@entifix/react-controls/primitives';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';

import { countInWords, type CountLabels } from './cart-count';
import { CART_COOKIE, cartCount, parseCart } from './cart-state';

/**
 * The one place where "static-first" and "personalized" actually collide.
 *
 * The header sits inside prerendered pages, so at build time there is no cart
 * and no count to render — but a visitor with three items must not be handed a
 * page that says otherwise. The resolution is not to give up the prerender: the
 * static HTML ships the label with **no count**, and the browser fills it in
 * from the cookie.
 *
 * `useSyncExternalStore` rather than `useState` + an effect, because that is
 * precisely what it is for: the cookie is an external store, and the hook takes
 * a separate server snapshot, so React renders `0` on the server and the real
 * count on the client without either a hydration mismatch or a cascading
 * re-render.
 */
export interface CartBadgeProps {
  /** Already locale-prefixed — this component has no route param to read. */
  readonly href: string;
  readonly label: string;
  /** The page's locale, for choosing the count's plural form. */
  readonly locale: string;
  /**
   * The count in words, "`COUNT_MARK` artículo(s)", one per plural
   * form, already translated (#574). The number alone said neither "items"
   * nor that it was a count; this is the hidden text that does.
   */
  readonly countLabels: CountLabels;
}

/**
 * Nothing to subscribe to: a cookie emits no events. The count changes when the
 * visitor navigates, and every navigation re-renders this component, which
 * re-reads the snapshot. A mutation redirects (see `addToCart`) for exactly
 * this reason.
 */
function subscribe() {
  return () => undefined;
}

function readCount() {
  const match = document.cookie
    .split('; ')
    .find(entry => entry.startsWith(`${CART_COOKIE}=`));

  if (!match) return 0;

  // `document.cookie` hands the value back percent-encoded — `code:qty` pairs
  // arrive as `code%3Aqty%2C…` — so the separators this format splits on are
  // not there until it is decoded. The server never sees this, because Next's
  // `cookies()` decodes for you; the bug can only appear in a browser.
  return cartCount(
    parseCart(decodeURIComponent(match.slice(CART_COOKIE.length + 1))),
  );
}

/** What a prerendered page renders: a badge with nothing to say yet. */
function serverCount() {
  return 0;
}

export function CartBadge({
  href,
  label,
  locale,
  countLabels,
}: CartBadgeProps) {
  const count = useSyncExternalStore(subscribe, readCount, serverCount);
  // In parentheses, with its own leading space: a browser may or may not put
  // a space before a visually hidden span, so a comma could be read after one.
  const spoken = ` (${countInWords(count, locale, countLabels)})`;

  return (
    <Link
      href={href}
      data-testid="cart-badge"
      className="touch-target inline-flex items-center justify-center rounded-md focus-ring"
    >
      <Text muted>
        {label}
        {count > 0 ? (
          <>
            {/* The chip is the eye's; the hidden words are the ear's, so the
                link is named "Carrito (1 artículo)" rather than "Carrito 1".
                Primary on its own content: a pair the palette gate already
                holds to contrast, unlike the tinted accent it replaces. */}
            <span
              aria-hidden="true"
              className="ml-2xs rounded-md bg-primary px-2xs py-3xs text-step-xs font-medium text-primary-content"
              data-testid="cart-count"
            >
              {count}
            </span>
            <span className="sr-only">{spoken}</span>
          </>
        ) : null}
      </Text>
    </Link>
  );
}
