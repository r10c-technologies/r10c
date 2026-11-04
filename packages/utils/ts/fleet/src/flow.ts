/** The header a caller presents the coordinator's inbound crossing token in. */
export const CROSSING_TOKEN_HEADER = 'x-crossing-token';

/** The header a flow start is made idempotent on (ADR 0068). */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** What the coordinator answered: its status, content type and body. */
export interface FlowStartResponse {
  readonly status: number;
  readonly contentType: string | undefined;
  readonly payload: unknown;
}

/**
 * Starts a flow on the coordinator — `POST <coordinator>/flow/<recipe>` with
 * the start input as the body and the inbound crossing token — and answers what
 * the coordinator said: `202` with a `flowAccepted` envelope, or the problem it
 * refused with
 * ([ADR 0066](../../../../../docs/adr/0066-flows-run-on-a-durable-workflow-engine.md)).
 *
 * The fleet's one copy of the request every host that starts a flow writes. A
 * body that will not parse is `undefined` rather than a failure; a coordinator
 * that cannot be reached rejects, which is the caller's to answer.
 *
 * `init` is for what only a host knows — a Next server action passes
 * `cache: 'no-store'`, because a cached checkout is a buyer told their flow
 * began because somebody else's did.
 */
export const postFlow = async (
  coordinatorUrl: string,
  crossingToken: string,
  recipe: string,
  input: unknown,
  idempotencyKey: string,
  init: Omit<RequestInit, 'method' | 'headers' | 'body'> = {},
): Promise<FlowStartResponse> => {
  const response = await fetch(`${coordinatorUrl}/flow/${recipe}`, {
    ...init,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CROSSING_TOKEN_HEADER]: crossingToken,
      // An RFC 9651 String: the key quoted, `\` and `"` escaped.
      [IDEMPOTENCY_KEY_HEADER]: `"${idempotencyKey.replace(/[\\"]/g, char => `\\${char}`)}"`,
    },
    body: JSON.stringify(input),
  });
  // Inside the promise, so a body that cannot be read at all — not merely one
  // that will not parse — is `undefined` too.
  const payload: unknown = await Promise.resolve()
    .then(() => response.json())
    .catch(() => undefined);
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? undefined,
    payload,
  };
};
