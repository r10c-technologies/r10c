import { EntifixError } from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import {
  AuthnError,
  LockedError,
  UnauthenticatedError,
} from './authn-error.js';

// Both stay in the `EntifixError` hierarchy so shells can pattern-match on
// `_tag` on the same failure channel as the rest of the domain — and the two
// tags must stay distinct, since one means "sign in" and the other "something
// broke".
describe('the authn errors', () => {
  it.each([
    [UnauthenticatedError, 'UnauthenticatedError'],
    [AuthnError, 'AuthnError'],
  ])('%p carries its own _tag', (Ctor, tag) => {
    const error = new Ctor('boom');

    expect(error._tag).toBe(tag);
    expect(error).toBeInstanceOf(EntifixError);
    expect(error.message).toBe('boom');
  });

  it('keeps the two tags distinct', () => {
    expect(new UnauthenticatedError('a')._tag).not.toBe(
      new AuthnError('a')._tag,
    );
  });

  it('carries a code, cause and details through', () => {
    const cause = new Error('provider down');
    const error = new AuthnError('unreachable', 'unexpected', cause, {
      provider: 'zitadel',
    });

    expect(error.code).toBe('unexpected');
    expect(error.cause).toBe(cause);
    expect(error.details).toEqual({ provider: 'zitadel' });
  });

  // The code is what the client renders; the message stays a developer-facing
  // sentence for logs. An error raised without one still has to work.
  it('leaves the code absent when none is given', () => {
    expect(new AuthnError('unreachable').code).toBeUndefined();
  });

  // 429, not 401: the credentials were never consulted, so a caller told
  // "invalid credentials" would go off resetting a password that was fine.
  it('distinguishes a lockout from a bad credential', () => {
    const locked = new LockedError('too many attempts', 'accountLocked');

    expect(locked._tag).toBe('LockedError');
    expect(locked._tag).not.toBe(new UnauthenticatedError('a')._tag);
    expect(locked.code).toBe('accountLocked');
  });
});
