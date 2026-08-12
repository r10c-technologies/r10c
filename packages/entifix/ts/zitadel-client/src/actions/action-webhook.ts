import { createHmac, timingSafeEqual } from 'node:crypto';

import { EntifixLogicError } from '@r10c/entifix-ts-core';
import { Context, Effect, Layer } from 'effect';

/**
 * The header Zitadel signs an Actions v2 payload with.
 *
 * Read from the sender, not from the docs: `internal/execution/execution.go`
 * sets `actions.SigningHeader`, which is this exact spelling. The `CreateTarget`
 * proto comment claims `X-ZITADEL-Signature` and is wrong for v4.16.2 — we pin
 * the one the running instance actually sends rather than accepting both, since
 * a second accepted spelling is a second thing to get wrong later.
 */
export const ACTION_SIGNATURE_HEADER = 'zitadel-signature';

/**
 * How far the signature's own timestamp may be from now, matching Zitadel's
 * `DefaultTolerance`. It is what bounds replay: the payload is signed over the
 * timestamp, so an old capture cannot be re-dated without breaking the MAC.
 */
export const ACTION_SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * The user-lifecycle events that must end an r10c session.
 *
 * All three are `user` aggregate events, so `aggregateID` is the Zitadel user id
 * in every case — the same value that arrives as `sub` in an `id_token` and is
 * stored as the account's `external-subject` identifier. That is what lets one
 * handler serve all three without knowing anything about them individually.
 */
export const PROVIDER_USER_LIFECYCLE_EVENTS = [
  'user.deactivated',
  'user.locked',
  'user.removed',
] as const;

export type ProviderUserLifecycleEvent =
  (typeof PROVIDER_USER_LIFECYCLE_EVENTS)[number];

/** A verified Actions v2 event, reduced to what session revocation needs. */
export interface ProviderUserEvent {
  /** e.g. `user.deactivated`. Kept for logging and for the no-op branch. */
  readonly eventType: string;
  /** The `aggregateID`: the provider's user id, i.e. the OIDC `sub`. */
  readonly subject: string;
  /**
   * True when {@link eventType} is one this platform acts on. An execution can be
   * added at the provider without a deploy here, so an unrecognised type must be
   * a no-op rather than an error.
   */
  readonly revokesSessions: boolean;
}

/** How the verifier is pointed at a target. Resolved from config-service at boot. */
export interface ZitadelActionsConfig {
  /**
   * The key Zitadel minted when the target was created. It is returned **only**
   * from `CreateTarget` and can never be read back, which is why
   * `tools/zitadel-seed.mjs` stamps it into `.generated.env` and carries it
   * forward across re-seeds.
   */
  readonly signingKey: string;
}

export interface ZitadelActions {
  /**
   * Verify a webhook call and say what it asks for.
   *
   * Takes the **raw** body, not a parsed object: the MAC covers the bytes
   * Zitadel sent, and a re-serialised object is a different sequence of bytes.
   */
  verifyEvent(
    rawBody: string,
    signatureHeader: string | undefined,
  ): Effect.Effect<ProviderUserEvent, EntifixLogicError>;
}

export class ZitadelActionsTag extends Context.Tag('ZitadelActionsTag')<
  ZitadelActionsTag,
  ZitadelActions
>() {}

interface ParsedSignature {
  readonly timestamp: number;
  readonly signatures: readonly string[];
}

/**
 * `t=<unix>,v1=<hex>` — and there may be more than one `v1=`, because Zitadel's
 * `ComputeSignatureHeader` takes a list of keys and appends one part per key.
 * Accepting only the first would break the moment a key is rotated with an
 * overlap window.
 */
const parseSignatureHeader = (header: string): ParsedSignature | undefined => {
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [name, value] = part.trim().split('=', 2);
    if (value === undefined || value === '') continue;
    if (name === 't') timestamp = Number(value);
    if (name === 'v1') signatures.push(value);
  }
  if (timestamp === undefined || !Number.isFinite(timestamp)) return undefined;
  if (signatures.length === 0) return undefined;
  return { timestamp, signatures };
};

const signaturesMatch = (expected: Buffer, candidate: string): boolean => {
  const actual = Buffer.from(candidate, 'hex');
  // `timingSafeEqual` throws on a length mismatch, and a wrong-length signature
  // is a mismatch we can answer without looking at the bytes anyway.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

/**
 * The security boundary of this file: whether a request that named a user
 * deactivation really came from the identity provider.
 *
 * The endpoint it guards is unauthenticated by necessity — the caller is a
 * server holding no cookie — exactly as the back-channel logout route is
 * (ADR 0017). There the token's own signature is the authentication; here it is
 * this HMAC, computed the way Zitadel's `pkg/actions/signing.go` computes it:
 * `HMAC-SHA256(signingKey, "<unix timestamp>.<raw body>")`, hex.
 *
 * An empty key **fails closed**. A fleet whose signing key never arrived (the
 * seed did not run, the config row is blank) must reject every call rather than
 * accept anonymous requests to revoke anyone's sessions — the one failure mode
 * that would be strictly worse than the bug this closes.
 */
export const verifyActionSignature = (
  rawBody: string,
  signatureHeader: string | undefined,
  signingKey: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean => {
  if (signingKey === '' || signatureHeader === undefined) return false;
  const parsed = parseSignatureHeader(signatureHeader);
  if (parsed === undefined) return false;
  if (
    Math.abs(nowSeconds - parsed.timestamp) > ACTION_SIGNATURE_TOLERANCE_SECONDS
  ) {
    return false;
  }
  const expected = createHmac('sha256', signingKey)
    .update(`${String(parsed.timestamp)}.${rawBody}`)
    .digest();
  return parsed.signatures.some(candidate =>
    signaturesMatch(expected, candidate),
  );
};

const isLifecycleEvent = (eventType: string): boolean =>
  (PROVIDER_USER_LIFECYCLE_EVENTS as readonly string[]).includes(eventType);

/**
 * Zitadel's event payload, of which only two fields matter here. `event_type` is
 * snake_case in the JSON while `aggregateID` is not — that asymmetry is the
 * provider's, not a typo.
 */
const readEvent = (rawBody: string): ProviderUserEvent | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const body = parsed as Record<string, unknown>;
  const eventType = body['event_type'];
  const subject = body['aggregateID'];
  if (typeof eventType !== 'string' || eventType === '') return undefined;
  if (typeof subject !== 'string' || subject === '') return undefined;
  return {
    eventType,
    subject,
    revokesSessions: isLifecycleEvent(eventType),
  };
};

/**
 * A verifier for the Actions v2 webhook a Zitadel event execution calls.
 *
 * Deliberately separate from {@link ZitadelOidc}: that one speaks OIDC and
 * verifies asymmetric provider JWTs against a published key set, this one
 * verifies a shared-secret MAC over an arbitrary JSON body. Folding them
 * together would put a symmetric key next to the pinned-`algorithms` verifier
 * whose whole purpose is that no symmetric key is ever accepted there.
 */
export const makeZitadelActions = (
  config: ZitadelActionsConfig,
): ZitadelActions => ({
  verifyEvent: (rawBody, signatureHeader) =>
    Effect.suspend(() => {
      if (!verifyActionSignature(rawBody, signatureHeader, config.signingKey)) {
        return Effect.fail(
          new EntifixLogicError('the action payload signature did not verify'),
        );
      }
      const event = readEvent(rawBody);
      return event === undefined
        ? Effect.fail(
            new EntifixLogicError(
              'the action payload is not a user event: no event_type or aggregateID',
            ),
          )
        : Effect.succeed(event);
    }),
});

/** Binds {@link ZitadelActionsTag} from a resolved configuration. */
export const ZitadelActionsLayer = (
  config: ZitadelActionsConfig,
): Layer.Layer<ZitadelActionsTag> =>
  Layer.succeed(ZitadelActionsTag, makeZitadelActions(config));
