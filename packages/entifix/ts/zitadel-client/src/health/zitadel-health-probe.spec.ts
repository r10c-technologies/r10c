import type { HealthReport } from '@r10c/entifix-ts-business';
import {
  HealthRegistryLayer,
  HealthRegistryTag,
} from '@r10c/entifix-ts-business';
import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ZITADEL_PROBE_NAME,
  ZitadelHealthProbeLayer,
} from './zitadel-health-probe';

const ISSUER = 'https://idp.test';

let fetchMock: ReturnType<typeof vi.fn>;

const reportFor = (issuer = ISSUER): Promise<HealthReport> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* HealthRegistryTag;
      return yield* registry.report;
    }).pipe(
      Effect.provide(
        ZitadelHealthProbeLayer(issuer).pipe(
          Layer.provideMerge(HealthRegistryLayer),
        ),
      ),
    ),
  );

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ZitadelHealthProbeLayer', () => {
  it('reports ready when the instance is serving', async () => {
    fetchMock.mockResolvedValue({ ok: true });

    expect(await reportFor()).toEqual({ ready: true, failing: [] });
  });

  it('asks the unauthenticated readiness endpoint', async () => {
    // A readiness check must not spend a credential, and `/debug/ready` reveals
    // nothing beyond whether the instance is serving.
    fetchMock.mockResolvedValue({ ok: true });

    await reportFor();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://idp.test/debug/ready',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('tolerates a trailing slash on the issuer', async () => {
    fetchMock.mockResolvedValue({ ok: true });

    await reportFor('https://idp.test/');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://idp.test/debug/ready',
      expect.anything(),
    );
  });

  it('reports failing while the instance is still initialising', async () => {
    // Zitadel accepts connections for about a minute before it can serve a
    // login, which is exactly the window this probe exists to describe.
    fetchMock.mockResolvedValue({ ok: false });

    expect(await reportFor()).toEqual({
      ready: false,
      failing: [ZITADEL_PROBE_NAME],
    });
  });

  it('reports failing rather than hanging when nothing answers', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    expect(await reportFor()).toEqual({
      ready: false,
      failing: [ZITADEL_PROBE_NAME],
    });
  });

  it('deadlines the request', async () => {
    // The failure mode that matters: an instance mid-init accepts the socket
    // and then never answers, which would leave readiness hanging at the one
    // moment it has to reply.
    fetchMock.mockResolvedValue({ ok: true });

    await reportFor();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
