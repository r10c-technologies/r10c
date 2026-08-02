import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { CartBadge } from './cart-badge';

function setCartCookie(value: string) {
  document.cookie = `r10c_cart=${value}; path=/`;
}

afterEach(() => {
  document.cookie = 'r10c_cart=; path=/; max-age=0';
});

describe('CartBadge', () => {
  it('shows the label alone when the cart is empty', () => {
    render(<CartBadge href="/es/cart" label="Carrito" />);

    expect(screen.getByTestId('cart-badge')).toHaveAttribute(
      'href',
      '/es/cart',
    );
    expect(screen.queryByTestId('cart-count')).not.toBeInTheDocument();
  });

  it('totals the units in the cookie', () => {
    setCartCookie('AUR-LAMP-01:2,TER-MUG-01:1');

    render(<CartBadge href="/es/cart" label="Carrito" />);

    expect(screen.getByTestId('cart-count')).toHaveTextContent('3');
  });

  /**
   * The regression this exists for. `document.cookie` returns the value
   * percent-encoded, so `code:qty` pairs arrive as `code%3Aqty%2C…` and the
   * separators the format splits on are simply not there. The server never sees
   * it — Next's `cookies()` decodes — so nothing but a browser catches it, and
   * the symptom is a badge that silently stays at zero.
   */
  it('decodes the cookie before parsing it', () => {
    document.cookie = `r10c_cart=${encodeURIComponent('AUR-LAMP-01:2')}; path=/`;

    render(<CartBadge href="/es/cart" label="Carrito" />);

    expect(screen.getByTestId('cart-count')).toHaveTextContent('2');
  });

  it('ignores an unrelated cookie', () => {
    document.cookie = 'r10c_locale=es; path=/';

    render(<CartBadge href="/es/cart" label="Carrito" />);

    expect(screen.queryByTestId('cart-count')).not.toBeInTheDocument();
  });

  /**
   * The server snapshot, which is what a prerendered page bakes into its HTML.
   * It must be countless even when a cart exists — the build has no visitor —
   * and it is the reason this component uses `useSyncExternalStore` rather than
   * reading the cookie during render: the two snapshots are allowed to differ,
   * so there is no hydration mismatch to suppress.
   */
  it('renders no count on the server, whatever the cookie says', () => {
    setCartCookie('AUR-LAMP-01:2');

    const html = renderToString(<CartBadge href="/es/cart" label="Carrito" />);

    expect(html).toContain('Carrito');
    expect(html).not.toContain('cart-count');
  });
});
