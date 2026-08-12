import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import { signAccessToken } from '@r10c/entifix-ts-jwt-client';
import {
  E2E_FOREIGN_PRIVATE_KEY_PEM,
  E2E_KEY_ID,
  E2E_PRIVATE_KEY_PEM,
  E2E_PUBLIC_KEY_PEM,
} from '@r10c/entifix-ts-testing-e2e/fixtures';
import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';
import { bearerFor, signTokenFor } from '../support/tokens';

/**
 * The token-verified backend integration, mock profile only: signing a valid
 * token needs the private key, which the suite only holds in `mock`. The
 * unauthenticated `401` is asserted here too, alongside the `200`, so the guard
 * is covered end to end against the real router.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'MARKETPLACE_ADMIN_SERVICE_URL',
  startMock: startMockService,
});

const signTestToken = () =>
  signAccessToken(
    {
      userId: 'user-1',
      subject: 'user-1',
      sessionId: 'sess-1',
      roles: ['admin'],
    },
    {
      privateKeyPem: E2E_PRIVATE_KEY_PEM,
      publicKeyPem: E2E_PUBLIC_KEY_PEM,
      keyId: E2E_KEY_ID,
      issuer: AUTH_TOKEN_ISSUER,
      audience: AUTH_TOKEN_AUDIENCE,
    },
    900,
  );

describe('marketplace-admin-service /api/me guard', () => {
  it('rejects a request with no token', async () => {
    const res = await service.client.get('/api/me');

    expect(res.status).toBe(401);
  });

  it('accepts a valid bearer token and returns the principal', async () => {
    const token = await signTestToken();

    const res = await service.client.get('/api/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(res.data.userId).toBe('user-1');
    expect(res.data.roles).toEqual(['admin']);
  });

  it('accepts the token from the r10c_at cookie', async () => {
    const token = await signTestToken();

    const res = await service.client.get('/api/me', {
      headers: { Cookie: `r10c_at=${token}` },
    });

    expect(res.status).toBe(200);
    expect(res.data.userId).toBe('user-1');
  });

  it('rejects a token signed with a key the fleet does not trust', async () => {
    const foreign = await signAccessToken(
      { userId: 'x', subject: 'x', sessionId: 's', roles: [] },
      {
        privateKeyPem: E2E_FOREIGN_PRIVATE_KEY_PEM,
        // The *trusted* public key, deliberately: this is the forgery that
        // matters — a well-formed token whose `kid` names a key the service
        // knows, signed by a private key it has never seen.
        publicKeyPem: E2E_PUBLIC_KEY_PEM,
        keyId: E2E_KEY_ID,
        issuer: AUTH_TOKEN_ISSUER,
        audience: AUTH_TOKEN_AUDIENCE,
      },
      900,
    );

    const res = await service.client.get('/api/me', {
      headers: { Authorization: `Bearer ${foreign}` },
    });

    expect(res.status).toBe(401);
  });
});

/**
 * The catalog's authorization, which is the point of the whole exercise: the
 * navigation filtering in the app is presentation, and this is what actually
 * refuses a request. The 401/403 split matters — one says "sign in", the other
 * says signing in again will not help.
 */
describe('marketplace-admin-service catalog permissions', () => {
  it('rejects an anonymous read with 401', async () => {
    const res = await service.client.get('/api/product-specification');

    expect(res.status).toBe(401);
  });

  it('lets a plain user read the catalog', async () => {
    const res = await service.client.get('/api/product-specification', {
      headers: { Authorization: await bearerFor(['user']) },
    });

    expect(res.status).toBe(200);
  });

  it('refuses a plain user a catalog write with 403', async () => {
    const res = await service.client.post(
      '/api/product-specification',
      { name: 'Contraband' },
      { headers: { Authorization: await bearerFor(['user']) } },
    );

    expect(res.status).toBe(403);
    expect(res.data.permission).toBe(
      'product-configuration-management:product-specification:write',
    );
  });

  it('refuses a plain user a delete with 403', async () => {
    const res = await service.client.delete(
      '/api/product-specification/product-1',
      {
        headers: { Authorization: await bearerFor(['user']) },
      },
    );

    expect(res.status).toBe(403);
  });

  it('lets a super-admin through on the wildcard grant', async () => {
    const res = await service.client.get('/api/product-specification', {
      headers: { Authorization: await bearerFor(['super-admin']) },
    });

    expect(res.status).toBe(200);
  });

  it('refuses a catalog read to a permitted caller with no organization', async () => {
    // The catalog is tenant plane, so permission alone is not enough: without
    // an organization there is no storage to read. `409`, not `403` — the
    // caller is allowed, they just have no tenant scope. An operator lands here
    // by design, and reaching a tenant is an audited crossing rather than a
    // wider default.
    const token = await signTokenFor(['super-admin'], 'user-1', null);

    const res = await service.client.get('/api/product-specification', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(409);
    expect(res.data.code).toBe('no-active-organization');
  });
});
