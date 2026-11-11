import { isFailure } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import {
  AccountInactive,
  EmailRequired,
  IdentifierInUse,
  IdentifierRequired,
  InvalidCredentials,
  InvalidRequest,
  InvalidState,
  NotAMember,
  NothingToUpdate,
  ProviderUnavailable,
  RoleNotAllowed,
  SelfRoleChange,
  SessionExpired,
  SessionUnresolved,
  SignInFailed,
  UnknownRole,
  UnknownStatus,
  UserNotAllowed,
  UserNotFound,
} from './authn-failures.js';

describe('the authn refusals', () => {
  it('are typed failures with the codes the errors catalog renders', () => {
    const refusals = [
      new InvalidCredentials(),
      new InvalidState(),
      new AccountInactive(),
      new SessionExpired(),
      new SessionUnresolved(),
      new InvalidRequest({ reason: 'no code' }),
      new IdentifierRequired(),
      new EmailRequired(),
      new UnknownRole(),
      new UnknownStatus(),
      new NothingToUpdate(),
      new UserNotFound({ userId: 'u-1' }),
      new RoleNotAllowed({ role: 'admin' }),
      new UserNotAllowed({ role: 'admin' }),
      new NotAMember(),
      new SelfRoleChange(),
      new IdentifierInUse(),
      new SignInFailed(),
      new ProviderUnavailable(),
    ];

    expect(refusals.every(isFailure)).toBe(true);
    expect(refusals.map(refusal => [refusal.code, refusal.category])).toEqual([
      ['invalidCredentials', 'unauthenticated'],
      ['invalidState', 'unauthenticated'],
      ['accountInactive', 'unauthenticated'],
      ['sessionExpired', 'unauthenticated'],
      ['sessionUnresolved', 'unauthenticated'],
      ['invalidRequest', 'invalid'],
      ['identifierRequired', 'invalid'],
      ['emailRequired', 'invalid'],
      ['unknownRole', 'invalid'],
      ['unknownStatus', 'invalid'],
      ['nothingToUpdate', 'invalid'],
      ['userNotFound', 'notFound'],
      ['roleNotAllowed', 'forbidden'],
      ['userNotAllowed', 'forbidden'],
      ['notAMember', 'forbidden'],
      ['selfRoleChange', 'forbidden'],
      ['identifierInUse', 'conflict'],
      ['signInFailed', 'conflict'],
      ['providerUnavailable', 'conflict'],
    ]);
    expect(refusals.map(refusal => refusal.message)).toEqual([
      'invalid credentials',
      'the authorization state is unknown or spent',
      'the account is not active',
      'session expired',
      'session could not be resolved',
      'no code',
      'an account needs at least one identifier',
      'an email identifier is required',
      'unknown role',
      'unknown status',
      'nothing to update',
      'no user u-1',
      'not allowed to assign that role',
      'not allowed to modify that user',
      'not a member of that organization',
      'cannot change your own role or status',
      'identifier already in use',
      'sign-in could not be resolved',
      'the identity provider could not be provisioned',
    ]);
  });
});
