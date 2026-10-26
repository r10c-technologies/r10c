import type { DeviceContext } from '@entifix/business';
import { Effect } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';

export const serverError = (error: unknown) =>
  HttpServerResponse.json(
    { error: 'request failed', code: 'unexpected', detail: String(error) },
    { status: 500 },
  );

export const invalidRequest = () =>
  HttpServerResponse.json(
    { error: 'invalid request', code: 'invalidRequest' },
    { status: 400 },
  );

export const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** Read the JSON request body as a record. */
export const readBody = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;
  const body = yield* req.json;
  return (body ?? {}) as Record<string, unknown>;
});

/**
 * Map an authn failure to a status without leaking the cause.
 *
 * Every body carries a `code` — a key in the shared `errors` catalog — beside
 * the English `error`. The client renders the code; `error` stays for logs and
 * for any consumer that has not been taught the vocabulary. This used to send
 * the domain's own `message` as the response body, so a Spanish user read
 * "not allowed to assign that role".
 */
export const respondAuthError = (error: { _tag?: string }) => {
  const code = (error as { code?: string }).code;
  const message = (error as { message?: string }).message;

  switch (error._tag) {
    case 'UnauthenticatedError':
      return HttpServerResponse.json(
        { error: 'invalid credentials', code: code ?? 'invalidCredentials' },
        { status: 401 },
      );
    // Authenticated, but not permitted — the opposite of a 401, and not a
    // conflict either. Which rule refused is safe to say: knowing it reveals
    // nothing the caller could not infer.
    case 'ForbiddenError':
      return HttpServerResponse.json(
        { error: message ?? 'forbidden', code: code ?? 'forbidden' },
        { status: 403 },
      );
    case 'AuthnError':
      return HttpServerResponse.json(
        { error: message ?? 'request refused', code: code ?? 'invalidRequest' },
        { status: 409 },
      );
    case 'EntifixBuildError':
      return HttpServerResponse.json(
        { error: 'invalid request', code: 'invalidRequest' },
        { status: 400 },
      );
    default:
      return HttpServerResponse.json(
        { error: 'authentication failed', code: 'unexpected' },
        { status: 500 },
      );
  }
};

/** Read the optional device struct the `-app` edge parsed for us. */
export const readDevice = (
  body: Record<string, unknown>,
): DeviceContext | undefined => {
  const raw = body['device'];
  if (typeof raw !== 'object' || raw === null) return undefined;
  const entry = raw as Record<string, unknown>;
  const deviceId = asString(entry['deviceId']);
  if (deviceId === undefined) return undefined;
  return {
    deviceId,
    browser: asString(entry['browser']),
    os: asString(entry['os']),
    type: asString(entry['type']),
    ip: asString(entry['ip']),
  };
};
