import { EntifixError } from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import { AuthnError, UnauthenticatedError } from './authn-error.js';

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
    expect(new UnauthenticatedError('a')._tag).not.toBe(new AuthnError('a')._tag);
  });

  it('carries a cause and details through', () => {
    const cause = new Error('provider down');
    const error = new AuthnError('unreachable', cause, { provider: 'zitadel' });

    expect(error.cause).toBe(cause);
    expect(error.details).toEqual({ provider: 'zitadel' });
  });
});
