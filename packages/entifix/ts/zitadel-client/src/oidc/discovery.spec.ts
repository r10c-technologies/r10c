import { Effect, Exit } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearDiscoveryCache, discover } from './discovery';

const ISSUER = 'https://idp.test';

const documentFor = (issuer: string) => ({
  issuer,
  authorization_endpoint: `${issuer}/oauth/v2/authorize`,
  token_endpoint: `${issuer}/oauth/v2/token`,
  userinfo_endpoint: `${issuer}/oidc/v1/userinfo`,
  end_session_endpoint: `${issuer}/oidc/v1/end_session`,
  jwks_uri: `${issuer}/oauth/v2/keys`,
});

const jsonResponse = (body: unknown, ok = true) =>
  ({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearDiscoveryCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('discover', () => {
  it('reads the document from the issuer', async () => {
    fetchMock.mockResolvedValue(jsonResponse(documentFor(ISSUER)));

    const discovery = await Effect.runPromise(discover(ISSUER));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://idp.test/.well-known/openid-configuration',
      { headers: { accept: 'application/json' } },
    );
    expect(discovery.token_endpoint).toBe('https://idp.test/oauth/v2/token');
  });

  it('tolerates a trailing slash on the issuer', () => {
    // Config is hand-edited through the config CRUD, so one will arrive with a
    // slash eventually; a doubled `//` is a 404 nobody would attribute to this.
    fetchMock.mockResolvedValue(jsonResponse(documentFor(ISSUER)));

    return Effect.runPromise(discover('https://idp.test/')).then(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'https://idp.test/.well-known/openid-configuration',
        expect.anything(),
      );
    });
  });

  it('fetches once per issuer and replays the result', async () => {
    fetchMock.mockResolvedValue(jsonResponse(documentFor(ISSUER)));

    await Effect.runPromise(discover(ISSUER));
    await Effect.runPromise(discover(ISSUER));
    await Effect.runPromise(discover(ISSUER));

    // A document describes an instance's shape, not its state. Re-fetching per
    // sign-in would put a round trip on the login path for nothing.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps separate documents per issuer', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(documentFor(ISSUER)))
      .mockResolvedValueOnce(jsonResponse(documentFor('https://other.test')));

    const first = await Effect.runPromise(discover(ISSUER));
    const second = await Effect.runPromise(discover('https://other.test'));

    expect(first.issuer).toBe(ISSUER);
    expect(second.issuer).toBe('https://other.test');
  });

  it('fails when the issuer does not answer', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false));

    const exit = await Effect.runPromiseExit(discover(ISSUER));

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('does NOT memoise a failure', async () => {
    // The identity provider is usually just still booting. Caching the
    // rejection would make the first failed sign-in permanent until restart.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(jsonResponse(documentFor(ISSUER)));

    await Effect.runPromiseExit(discover(ISSUER));
    const discovery = await Effect.runPromise(discover(ISSUER));

    expect(discovery.issuer).toBe(ISSUER);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a document missing an endpoint it will later need', async () => {
    // Otherwise this surfaces as `fetch(undefined)` mid-sign-in, where nothing
    // points back at the document as the cause.
    const incomplete: Record<string, unknown> = { ...documentFor(ISSUER) };
    delete incomplete['token_endpoint'];
    fetchMock.mockResolvedValue(jsonResponse(incomplete));

    const error = await Effect.runPromise(Effect.flip(discover(ISSUER)));

    expect(error.message).toContain('token_endpoint');
  });

  it('rejects a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const exit = await Effect.runPromiseExit(discover(ISSUER));

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
