import { IDEMPOTENCY_KEY_HEADER } from '@entifix/core';
import {
  CROSSING_TOKEN_HEADER,
  ORGANIZATION_HEADER,
} from '@entifix/service-shell';
import type { ServedRoutes } from '@r10c/testing-http';
import { describe, expect, it } from 'vitest';

import { CROSSING_TOKEN, crossingCall, tokenClaims } from './index.js';

describe('tokenClaims', () => {
  it('is a vendor admin in org-1 unless told otherwise', () => {
    expect(tokenClaims()).toMatchObject({
      roles: ['admin'],
      activeOrganizationId: 'org-1',
    });
    expect(tokenClaims({ roles: ['user'] }).roles).toEqual(['user']);
  });
});

describe('crossingCall', () => {
  const recorder = () => {
    const calls: { path: string; init: RequestInit }[] = [];
    const served: ServedRoutes = {
      call: (path, init = {}) => {
        calls.push({ path, init });
        return Promise.resolve(new Response(null));
      },
      dispose: () => Promise.resolve(),
    };
    return { served, calls };
  };

  it('presents the crossing token, and the command and organization when given', async () => {
    const { served, calls } = recorder();

    await crossingCall(served, '/a', {
      body: { x: 1 },
      commandId: 'c-1',
      organizationId: 'acme',
    });
    await crossingCall(served, '/b', { method: 'DELETE' });

    expect(calls[0]).toEqual({
      path: '/a',
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [CROSSING_TOKEN_HEADER]: CROSSING_TOKEN,
          [IDEMPOTENCY_KEY_HEADER]: '"c-1"',
          [ORGANIZATION_HEADER]: 'acme',
        },
        body: '{"x":1}',
      },
    });
    expect(calls[1]?.init).toEqual({
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        [CROSSING_TOKEN_HEADER]: CROSSING_TOKEN,
        // No command named: a fresh key, so the route's guard still has one.
        [IDEMPOTENCY_KEY_HEADER]: expect.stringMatching(/^"[0-9a-f-]{36}"$/),
      },
    });
  });
});
