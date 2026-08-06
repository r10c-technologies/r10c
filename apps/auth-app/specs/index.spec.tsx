import { render, screen } from '@testing-library/react';
import React from 'react';
import { vi } from 'vitest';

import Page from '../src/app/page';
import { Providers } from '../src/app/providers';

/**
 * `useSearchParams` returns `null` outside a Next router, so the page cannot
 * render at all without this. Mocking the hook rather than mounting a router is
 * the smaller lie: what this file asserts is the page's own markup, and the
 * error branch is worth reaching from here because it is otherwise only visible
 * after a failed round trip through a provider.
 */
const searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}));

describe('Page', () => {
  beforeEach(() => {
    searchParams.delete('error');
  });

  it('should render successfully', () => {
    const { baseElement } = render(
      <Providers>
        <Page />
      </Providers>,
    );
    expect(baseElement).toBeTruthy();
  });

  // The one action, and the absence of a credential field. A password input
  // appearing here would mean this app had started holding something again.
  it('offers a link to the hosted login and no credential input', () => {
    const { baseElement } = render(
      <Providers>
        <Page />
      </Providers>,
    );

    expect(
      baseElement.querySelector('a[href="/api/auth/oidc/start"]'),
    ).not.toBeNull();
    expect(baseElement.querySelector('input[type="password"]')).toBeNull();
  });

  it('renders a known error code as copy, not as the code', () => {
    searchParams.set('error', 'invalidState');

    render(
      <Providers>
        <Page />
      </Providers>,
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).not.toContain('invalidState');
    expect(alert.textContent?.length).toBeGreaterThan(0);
  });

  // Whatever produced an unrecognised code came from outside; rendering it raw
  // would put an attacker-chosen string on our sign-in page.
  it('falls back to generic copy for an unknown error code', () => {
    searchParams.set('error', '<script>alert(1)</script>');

    render(
      <Providers>
        <Page />
      </Providers>,
    );

    expect(screen.getByRole('alert').textContent).not.toContain('script');
  });
});
