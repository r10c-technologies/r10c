import { configValue, DEMO, present, vendorBearer } from '../support/lab';
import { openStream, type Stream } from '../support/stream';

/**
 * A stream whose token is about to expire is asked to reauthenticate before
 * `exp`, rather than closed with a `401` that would kill its `EventSource` for
 * good (ADR 0072): `event: reauth` at `exp − reauthMarginMs`, then the stream
 * ends and sends nothing more. A short-lived token is signed for the purpose —
 * the stream reads only its `exp`, so this is the token a shortened
 * `session.accessTokenTtlSeconds` would mint.
 */
const TTL_SECONDS = 70;

let stream: Stream | undefined;

afterAll(() => stream?.close());

it('asks for a reauth inside the margin before exp, never after it', async () => {
  const marginMs = Number(
    await configValue('realtime-service', 'realtime', 'reauthMarginMs'),
  );
  const issuedAt = Date.now();
  const bearer = await vendorBearer(DEMO.organizationId, TTL_SECONDS);
  // `exp` is whole seconds from the signing clock.
  const expMs = (Math.floor(issuedAt / 1000) + TTL_SECONDS) * 1000;

  stream = await openStream('short-lived', {
    bearer,
    topics: ['entity:product-order'],
  });
  expect(stream.status).toBe(200);

  const asked = await stream.until(
    frames => frames.some(frame => frame.event === 'reauth'),
    TTL_SECONDS * 1000,
  );
  expect(asked).toBe(true);
  const reauth = present(
    stream.frames.find(frame => frame.event === 'reauth'),
    'a reauth frame',
  );
  await stream.ended;
  const after = stream.frames.filter(frame => frame.at > reauth.at);

  console.info(
    'reauth',
    JSON.stringify({
      marginMs,
      askedBeforeExpMs: expMs - reauth.at,
      framesAfterReauth: after.length,
    }),
  );
  // Before `exp`, and no earlier than the margin (with a second for the
  // signing clock's rounding and the edge's hop).
  expect(reauth.at).toBeLessThan(expMs);
  expect(expMs - reauth.at).toBeLessThanOrEqual(marginMs + 1_500);
  expect(after).toEqual([]);
});
