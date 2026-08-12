import { describe, expect, it, vi } from 'vitest';

import { allowedRedirectOrigins, safeRedirect } from './redirect';

const SELF = 'http://localhost:3002';
/** `DEFAULT_REDIRECT`'s default — the admin app. */
const ADMIN = 'http://localhost:3001';

describe('safeRedirect', () => {
  it('falls back when nothing was asked for', () => {
    expect(safeRedirect(undefined, SELF)).toBe(ADMIN);
    expect(safeRedirect(null, SELF)).toBe(ADMIN);
    expect(safeRedirect('', SELF)).toBe(ADMIN);
  });

  it('resolves a relative path against this app', () => {
    // auth-app's own middleware writes bare paths pointing at its own routes.
    expect(safeRedirect('/account', SELF)).toBe(`${SELF}/account`);
  });

  it('allows an absolute url on a published origin', () => {
    expect(safeRedirect(`${ADMIN}/catalog/product`, SELF)).toBe(
      `${ADMIN}/catalog/product`,
    );
  });

  it('refuses an origin nobody published', () => {
    // The open redirect this exists to stop: sign in for real, then get
    // forwarded onward carrying our domain's credibility.
    expect(safeRedirect('https://evil.example/harvest', SELF)).toBe(ADMIN);
  });

  it('refuses a lookalike host', () => {
    expect(safeRedirect('http://localhost:3001.evil.example', SELF)).toBe(
      ADMIN,
    );
  });

  it('refuses a non-http scheme', () => {
    // These parse happily as URLs, which is exactly why the check is explicit.
    expect(safeRedirect('javascript:alert(1)', SELF)).toBe(ADMIN);
    expect(safeRedirect('data:text/html,<script>', SELF)).toBe(ADMIN);
  });

  it('refuses a protocol-relative url pointing elsewhere', () => {
    expect(safeRedirect('//evil.example/x', SELF)).toBe(ADMIN);
  });

  it('falls back on an unparseable value', () => {
    expect(safeRedirect('http://[', SELF)).toBe(ADMIN);
  });
});

describe('allowedRedirectOrigins', () => {
  it('omits self when no origin is given', async () => {
    // The callback route always knows its own origin; the allowlist is also
    // read without one, and must not put `undefined` in the list.
    expect(allowedRedirectOrigins()).toEqual([ADMIN]);
  });

  it('includes self when one is given', () => {
    expect(allowedRedirectOrigins(SELF)).toEqual([SELF, ADMIN]);
  });

  it('adds every origin configured for the rest of the fleet', async () => {
    // `AUTH_ALLOWED_REDIRECTS` is read at module load, so the module is
    // re-imported rather than the variable reassigned — which is also the
    // honest shape, since that is exactly how a deployment sets it.
    vi.resetModules();
    vi.stubEnv(
      'AUTH_ALLOWED_REDIRECTS',
      // The last two are junk on purpose: a malformed entry must be dropped
      // rather than throw, or one typo in an env var takes sign-in down.
      'http://localhost:3000/, http://localhost:3005, not-a-url, ',
    );
    const { allowedRedirectOrigins: reloaded } = await import('./redirect');

    expect(reloaded()).toEqual([
      ADMIN,
      'http://localhost:3000',
      'http://localhost:3005',
    ]);

    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
