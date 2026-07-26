import { I18nProvider } from '@r10c/entifix-react-controls';
import { render, renderHook, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { LocaleLink, useLocaleHref, usePathLocale } from './locale-link';

const pathname = vi.hoisted(() => ({ value: '/es/catalog' as string | null }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.value,
}));

describe('LocaleLink', () => {
  it('prefixes an in-app href with the active locale', () => {
    render(
      <I18nProvider locale="en">
        <LocaleLink href="/catalog/product">Products</LocaleLink>
      </I18nProvider>,
    );

    expect(screen.getByRole('link')).toHaveAttribute('href', '/en/catalog/product');
  });

  it('leaves an absolute href alone', () => {
    render(
      <I18nProvider locale="es">
        <LocaleLink href="https://example.com/x">Out</LocaleLink>
      </I18nProvider>,
    );

    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.com/x');
  });

  // `next/link` also accepts a UrlObject; there is no string to prefix, so it
  // has to pass through rather than throw.
  it('passes a UrlObject href through untouched', () => {
    render(
      <I18nProvider locale="en">
        <LocaleLink href={{ pathname: '/catalog' }}>Object</LocaleLink>
      </I18nProvider>,
    );

    expect(screen.getByText('Object')).toBeInTheDocument();
  });
});

describe('useLocaleHref', () => {
  it('is idempotent, so it is safe to apply at every call site', () => {
    const { result } = renderHook(() => useLocaleHref(), {
      wrapper: ({ children }) => <I18nProvider locale="es">{children}</I18nProvider>,
    });

    expect(result.current(result.current('/catalog'))).toBe('/es/catalog');
  });
});

describe('usePathLocale', () => {
  it('reads the locale off the browser path', () => {
    pathname.value = '/en/users';
    const { result } = renderHook(() => usePathLocale());

    expect(result.current).toBe('en');
  });

  it('reports nothing for an unprefixed path', () => {
    pathname.value = '/users';
    const { result } = renderHook(() => usePathLocale());

    expect(result.current).toBeUndefined();
  });

  // `usePathname` is null while Next is rendering outside a route.
  it('tolerates a null pathname', () => {
    pathname.value = null;
    const { result } = renderHook(() => usePathLocale());

    expect(result.current).toBeUndefined();
  });
});
