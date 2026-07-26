import { describe, expect, it } from 'vitest';

import { safeRedirect } from './redirect';

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
    expect(safeRedirect('http://localhost:3001.evil.example', SELF)).toBe(ADMIN);
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
