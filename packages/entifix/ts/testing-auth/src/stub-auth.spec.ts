import { PolicyDecisionTag } from '@entifix/authz';
import { TokenServiceTag } from '@entifix/business';
import { ACCESS_COOKIE } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  AllowAllPolicy,
  AllowAllPolicyLayer,
  FixedTokenServiceLayer,
  makeFixedTokenService,
} from './stub-layers';
import {
  STUB_CLAIMS,
  stubAccessToken,
  stubSessionCookie,
} from './stub-principal';

const payloadOf = (token: string): Record<string, unknown> =>
  JSON.parse(
    Buffer.from(token.split('.')[1] as string, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;

describe('stubAccessToken', () => {
  it('is three segments carrying the claims and an expiry', () => {
    const token = stubAccessToken();
    expect(token.split('.')).toHaveLength(3);
    expect(payloadOf(token)).toMatchObject({ ...STUB_CLAIMS });
    expect(payloadOf(token)['exp']).toBeGreaterThan(Date.now() / 1000);
  });

  it('carries claims it is handed', () => {
    const token = stubAccessToken({ ...STUB_CLAIMS, roles: ['user'] });
    expect(payloadOf(token)['roles']).toEqual(['user']);
  });

  it('is visibly not signed, so a real verifier can never accept it', () => {
    expect(stubAccessToken().endsWith('.entifix-stub-not-a-signature')).toBe(
      true,
    );
  });
});

describe('stubSessionCookie', () => {
  // The real cookie name — the whole design call of the stub.
  it('names the cookie every entifix reader looks for', () => {
    expect(stubSessionCookie().name).toBe(ACCESS_COOKIE);
  });

  it('holds a token for the claims it is handed', () => {
    const { value } = stubSessionCookie({ ...STUB_CLAIMS, roles: ['user'] });
    expect(payloadOf(value)['roles']).toEqual(['user']);
  });
});

describe('makeFixedTokenService', () => {
  it('verifies any token to the fixed claims', async () => {
    const service = makeFixedTokenService();
    await expect(Effect.runPromise(service.verify('anything'))).resolves.toBe(
      STUB_CLAIMS,
    );
  });

  it('signs a stub token for the claims it is asked to sign', async () => {
    const token = await Effect.runPromise(
      makeFixedTokenService().sign({ ...STUB_CLAIMS, roles: ['user'] }, 60),
    );
    expect(payloadOf(token)['roles']).toEqual(['user']);
  });

  it('is what the Layer provides', async () => {
    const claims = { ...STUB_CLAIMS, roles: ['user'] };
    const verified = await Effect.runPromise(
      Effect.flatMap(TokenServiceTag, service => service.verify('x')).pipe(
        Effect.provide(FixedTokenServiceLayer(claims)),
      ),
    );
    expect(verified).toBe(claims);
  });

  it('defaults the Layer to the stub principal', async () => {
    const verified = await Effect.runPromise(
      Effect.flatMap(TokenServiceTag, service => service.verify('x')).pipe(
        Effect.provide(FixedTokenServiceLayer()),
      ),
    );
    expect(verified).toBe(STUB_CLAIMS);
  });
});

describe('AllowAllPolicy', () => {
  const request = {
    subject: { roles: [] },
    resource: 'anything:at' as const,
    action: 'delete' as const,
  };

  it('grants a request no role would', () => {
    expect(AllowAllPolicy.decide(request)).toBe(true);
  });

  it('is what the Layer provides', async () => {
    const allowed = await Effect.runPromise(
      Effect.map(PolicyDecisionTag, policy => policy.decide(request)).pipe(
        Effect.provide(AllowAllPolicyLayer),
      ),
    );
    expect(allowed).toBe(true);
  });
});
