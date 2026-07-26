import { NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';

import {
  applySessionCookies,
  AT_COOKIE,
  clearSessionCookies,
  SID_COOKIE,
} from './cookies';

describe('applySessionCookies', () => {
  it('sizes the access cookie to the SESSION, not to the token', () => {
    const response = applySessionCookies(NextResponse.json({}), {
      accessToken: 'token',
      sessionId: 'sid',
      sessionExpiresIn: 604_800,
    });

    // The regression this guards: a cookie sized to the 15-minute token made an
    // expired token look identical to no session at all.
    expect(response.cookies.get(AT_COOKIE)?.value).toBe('token');
    expect(response.cookies.get(AT_COOKIE)?.maxAge).toBe(604_800);
    expect(response.cookies.get(SID_COOKIE)?.maxAge).toBe(604_800);
  });

  it('marks both cookies httpOnly and lax', () => {
    const response = applySessionCookies(NextResponse.json({}), {
      accessToken: 'token',
      sessionId: 'sid',
      sessionExpiresIn: 60,
    });

    // httpOnly is the whole reason browser JS never handles the token.
    expect(response.cookies.get(AT_COOKIE)?.httpOnly).toBe(true);
    expect(response.cookies.get(AT_COOKIE)?.sameSite).toBe('lax');
  });

  it('leaves the session id alone when a refresh omits it', () => {
    const response = applySessionCookies(NextResponse.json({}), {
      accessToken: 'fresh-token',
      sessionExpiresIn: 60,
    });

    expect(response.cookies.get(AT_COOKIE)?.value).toBe('fresh-token');
    expect(response.cookies.get(SID_COOKIE)).toBeUndefined();
  });
});

describe('clearSessionCookies', () => {
  it('deletes both cookies', () => {
    const response = clearSessionCookies(NextResponse.json({}));

    // `delete` writes an expiring cookie rather than removing the header.
    expect(response.cookies.get(AT_COOKIE)?.value).toBe('');
    expect(response.cookies.get(SID_COOKIE)?.value).toBe('');
  });
});
