/** The header a caller presents the saga coordinator's inbound crossing token in. */
export const CROSSING_TOKEN_HEADER = 'x-crossing-token';

/** The header a flow start is made idempotent on (ADR 0068). */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** What the coordinator answered: its status, and its body when it had one. */
export interface SagaResponse {
  readonly status: number;
  readonly payload: unknown;
}

/**
 * Starts a flow on the saga coordinator — `POST <coordinator>/saga/<definition>`
 * with the inbound crossing token — and answers what the coordinator said.
 *
 * The fleet's one copy of the request three hosts used to write by hand. A body
 * that will not parse is `undefined` rather than a failure: by then the flow
 * has run, and the status is what says how. A coordinator that cannot be
 * reached rejects, which is the caller's to answer.
 *
 * `init` is for what only a host knows — a Next server action passes
 * `cache: 'no-store'`, because a cached checkout is a buyer told their order
 * succeeded because somebody else's did.
 */
export const postSaga = async (
  coordinatorUrl: string,
  crossingToken: string,
  definition: string,
  inputs: unknown,
  idempotencyKey: string,
  init: Omit<RequestInit, 'method' | 'headers' | 'body'> = {},
): Promise<SagaResponse> => {
  const response = await fetch(`${coordinatorUrl}/saga/${definition}`, {
    ...init,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CROSSING_TOKEN_HEADER]: crossingToken,
      // An RFC 9651 String: the key quoted, `\` and `"` escaped.
      [IDEMPOTENCY_KEY_HEADER]: `"${idempotencyKey.replace(/[\\"]/g, char => `\\${char}`)}"`,
    },
    body: JSON.stringify({ inputs }),
  });
  // Inside the promise, so a body that cannot be read at all — not merely one
  // that will not parse — is `undefined` too.
  const payload: unknown = await Promise.resolve()
    .then(() => response.json())
    .catch(() => undefined);
  return { status: response.status, payload };
};
