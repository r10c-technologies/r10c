import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';

import {
  applyDeviceCookie,
  DID_COOKIE,
  readDeviceContext,
  truncateIp,
} from './device';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** The slice of `NextRequest` the reader touches. */
const requestWith = (
  options: { deviceId?: string; headers?: Record<string, string> } = {},
): NextRequest =>
  ({
    cookies: {
      get: (name: string) =>
        name === DID_COOKIE && options.deviceId !== undefined
          ? { name, value: options.deviceId }
          : undefined,
    },
    headers: new Headers({ 'user-agent': CHROME_MAC, ...options.headers }),
  }) as unknown as NextRequest;

describe('truncateIp', () => {
  it('keeps only the /24 of a v4 address', () => {
    // Enough to notice "this came from somewhere else", without keeping a
    // precise location against every session.
    expect(truncateIp('203.0.113.42')).toBe('203.0.113.0');
  });

  it('keeps only the leading v6 groups', () => {
    expect(truncateIp('2001:db8:85a3:1:2:3:4:5')).toBe('2001:db8:85a3:1::');
  });

  it('ignores anything that is not an address', () => {
    expect(truncateIp(undefined)).toBeUndefined();
    expect(truncateIp('')).toBeUndefined();
    expect(truncateIp('not-an-ip')).toBeUndefined();
  });
});

describe('readDeviceContext', () => {
  it('mints an id when the browser has none', () => {
    const { device, issued } = readDeviceContext(requestWith());

    expect(issued).toBe(true);
    // 32 random bytes, base64url — unguessable, and it grants nothing anyway.
    expect(device.deviceId.length).toBeGreaterThanOrEqual(43);
    expect(device.deviceId).not.toMatch(/[+/=]/);
  });

  it('reuses the id the browser already carries', () => {
    const { device, issued } = readDeviceContext(
      requestWith({ deviceId: 'known-device' }),
    );

    expect(issued).toBe(false);
    expect(device.deviceId).toBe('known-device');
  });

  it('labels the browser and os from the user agent', () => {
    // Parsed with Next's own `userAgent()`, so no dependency is added — and
    // notably not `ua-parser-js`, whose v2 is AGPL/dual-licensed.
    const { device } = readDeviceContext(requestWith());

    expect(device.browser).toBe('Chrome');
    expect(device.os).toBe('Mac OS');
    expect(device.type).toBe('desktop');
  });

  it('takes the first hop of x-forwarded-for, truncated', () => {
    const { device } = readDeviceContext(
      requestWith({
        headers: { 'x-forwarded-for': '203.0.113.42, 10.0.0.1' },
      }),
    );

    expect(device.ip).toBe('203.0.113.0');
  });

  it('falls back to x-real-ip', () => {
    const { device } = readDeviceContext(
      requestWith({ headers: { 'x-real-ip': '198.51.100.7' } }),
    );

    expect(device.ip).toBe('198.51.100.0');
  });

  it('reports no ip when the proxy sent none', () => {
    expect(readDeviceContext(requestWith()).device.ip).toBeUndefined();
  });

  it('mints unique ids', () => {
    const first = readDeviceContext(requestWith()).device.deviceId;
    const second = readDeviceContext(requestWith()).device.deviceId;

    expect(first).not.toBe(second);
  });
});

describe('applyDeviceCookie', () => {
  it('writes a long-lived httpOnly cookie', () => {
    const response = applyDeviceCookie(NextResponse.json({}), 'device-1');

    const cookie = response.cookies.get(DID_COOKIE);
    expect(cookie?.value).toBe('device-1');
    // Nothing in the browser needs to read it.
    expect(cookie?.httpOnly).toBe(true);
    // Two years: long enough that a familiar browser stays familiar.
    expect(cookie?.maxAge).toBe(60 * 60 * 24 * 730);
  });
});
