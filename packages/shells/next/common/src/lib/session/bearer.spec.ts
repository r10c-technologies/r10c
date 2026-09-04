import { afterEach, describe, expect, it, vi } from 'vitest';

import { bearerHeader, sessionToken } from './bearer';

const cookieValue = vi.fn<() => string | undefined>(() => 'the-token');

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = cookieValue();
        return name === 'r10c_at' && value !== undefined
          ? { name, value }
          : undefined;
      },
    }),
}));

afterEach(() => {
  cookieValue.mockReturnValue('the-token');
});

describe('sessionToken', () => {
  it('reads the access cookie', async () => {
    await expect(sessionToken()).resolves.toBe('the-token');
  });

  it('is undefined for a caller with no session', async () => {
    cookieValue.mockReturnValue(undefined);

    await expect(sessionToken()).resolves.toBeUndefined();
  });
});

describe('bearerHeader', () => {
  it('carries the token', () => {
    expect(bearerHeader('the-token')).toEqual({
      Authorization: 'Bearer the-token',
    });
  });

  // `Bearer undefined` is not "no credential", it is a malformed one. Both
  // currently answer `401`, which is exactly what would keep the difference
  // hidden until one of them stopped doing so.
  it('omits the header entirely when there is no token', () => {
    expect(bearerHeader(undefined)).toEqual({});
  });
});
