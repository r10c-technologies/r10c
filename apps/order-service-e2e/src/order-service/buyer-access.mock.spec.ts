import { createHash } from 'node:crypto';

import { defineServiceE2e } from '@entifix/testing-e2e/service';
import { documentOrderBody } from '@r10c/business-ts-order-management/testing';

import { sentMail, startMockService } from '../support/mock-service';
import {
  bearerFor,
  E2E_CROSSING_TOKEN,
  E2E_ORGANIZATION_ID,
  E2E_STOREFRONT_TOKEN,
} from '../support/tokens';

/**
 * Posts as the flow does: a step writing an order states its fiscal facts
 * (ADR 0078 §6), so every order body here is documented first.
 */
const post: typeof service.client.post = (path, body, config) =>
  service.client.post(
    path,
    path === '/api/product-order'
      ? (documentOrderBody(body as Record<string, unknown>) as typeof body)
      : body,
    config,
  );

/**
 * The buyer's way back to an order (ADR 0076 §6): the receipt mail a
 * storefront checkout ends with, and the one-time link inside it that re-keys
 * the receipt on another device. Mock only — the mail is read from the
 * profile's recording notifier rather than from an SMTP server.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'ORDER_SERVICE_URL',
  startMock: startMockService,
  authorization: () => bearerFor(['admin']),
});

const digest = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const crossing = () => ({
  'x-crossing-token': E2E_CROSSING_TOKEN,
  'idempotency-key': `"${crypto.randomUUID()}"`,
  Authorization: undefined,
});

const anonymous = { Authorization: undefined };

const CONTACT = {
  name: 'Ana López',
  phone: '5555-1234',
  email: 'ana@correo.com',
  destination: {
    departamento: '01',
    municipio: '0108',
    addressLine: '5a avenida 12-34',
  },
};

/** A storefront checkout's group, with its contact and one order in it. */
/** `null` opens a counter sale's group, which names no contact. */
const checkout = async (nonce: string, contact: unknown = CONTACT) => {
  const groupId = crypto.randomUUID();
  const opened = await post(
    '/api/checkout-group',
    {
      id: groupId,
      cancelDigest: digest(nonce),
      locale: 'es',
      ...(contact === null ? {} : { contact }),
    },
    { headers: crossing() },
  );
  expect(opened.status).toBe(200);
  const placed = await post(
    '/api/product-order',
    {
      vendorId: E2E_ORGANIZATION_ID,
      groupId,
      paymentMethod: 'card',
      items: [
        {
          offeringId: 'o-1',
          name: 'Lámpara Aurora',
          quantity: 1,
          amount: 4500,
          currency: 'GTQ',
        },
      ],
    },
    { headers: crossing() },
  );
  expect(placed.status).toBe(200);
  return groupId;
};

const mailReceipt = (groupId: string, headers: object = crossing()) =>
  post(`/api/checkout-group/${groupId}/receipt-mail`, {}, { headers });

const tokenOf = (text: string) =>
  decodeURIComponent(/token=([^\s"]+)/.exec(text)?.[1] ?? '');

const readReceipt = (groupId: string, nonce: string) =>
  service.client.get(`/api/checkout-group/${groupId}/buyer-receipt`, {
    headers: { ...anonymous, 'x-cancel-nonce': nonce },
  });

const redeem = (token: string, nonce: string) =>
  post(
    '/api/checkout-group/access',
    { token, capabilityDigest: digest(nonce) },
    { headers: anonymous },
  );

describe('the receipt mail', () => {
  it('mails the buyer once, with a link, and answers no token', async () => {
    const groupId = await checkout('first-nonce');
    const before = sentMail.sent.length;

    const res = await mailReceipt(groupId);

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ id: groupId, outcome: 'sent' });
    const mails = sentMail.sent.slice(before);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.to).toBe('ana@correo.com');
    const token = tokenOf(String(mails[0]?.text));
    expect(token).not.toBe('');
    expect(JSON.stringify(res.data)).not.toContain(token);
  });

  it('sends nothing for a counter sale, which has nobody to write to', async () => {
    const groupId = await checkout('counter-nonce', null);
    const before = sentMail.sent.length;

    const res = await mailReceipt(groupId);

    expect(res.data).toEqual({ id: groupId, outcome: 'no-contact' });
    expect(sentMail.sent.length).toBe(before);
  });

  it('takes a crossing token and no session', async () => {
    const groupId = await checkout('guard-nonce');

    const session = await mailReceipt(groupId, {
      ...crossing(),
      Authorization: await bearerFor(['admin']),
    });
    const wrong = await mailReceipt(groupId, {
      ...crossing(),
      'x-crossing-token': 'not-the-token',
    });

    expect(session.status).toBe(401);
    expect(wrong.status).toBe(401);
  });
});

describe('redeeming the mailed link', () => {
  it('re-keys the receipt once: the new nonce reads it, the old one no longer does', async () => {
    const groupId = await checkout('old-nonce');
    const before = sentMail.sent.length;
    await mailReceipt(groupId);
    const token = tokenOf(String(sentMail.sent[before]?.text));

    const redeemed = await redeem(token, 'new-nonce');
    const again = await redeem(token, 'other-nonce');
    const fresh = await readReceipt(groupId, 'new-nonce');
    const old = await readReceipt(groupId, 'old-nonce');

    expect(redeemed.status).toBe(200);
    expect(redeemed.data).toEqual({ id: groupId });
    expect(again.status).toBe(401);
    expect(fresh.status).toBe(200);
    expect(fresh.data.group.data).not.toHaveProperty('accessDigest');
    expect(old.status).toBe(401);
  });

  it('refuses a wrong token, and a missing one', async () => {
    expect((await redeem('guess', 'n')).status).toBe(401);
    expect(
      (await post('/api/checkout-group/access', {}, { headers: anonymous }))
        .status,
    ).toBe(401);
  });

  it('lets only the latest link open the receipt when the mail was sent again', async () => {
    const groupId = await checkout('retry-nonce');
    const before = sentMail.sent.length;
    await mailReceipt(groupId);
    await mailReceipt(groupId);
    const [first, second] = sentMail.sent.slice(before);

    expect((await redeem(tokenOf(String(first?.text)), 'a')).status).toBe(401);
    expect((await redeem(tokenOf(String(second?.text)), 'b')).status).toBe(200);
  });
});

describe('find my order', () => {
  const lookup = (body: object, headers: object = storefront()) =>
    post('/api/checkout-group/send-access-link', body, {
      headers,
    });
  const storefront = () => ({
    'x-crossing-token': E2E_STOREFRONT_TOKEN,
    Authorization: undefined,
  });
  const numberOf = async (groupId: string) =>
    String((await readReceipt(groupId, 'lookup-nonce')).data.group.data.number);

  it('answers a match and a miss byte for byte alike, and mails only the match', async () => {
    const groupId = await checkout('lookup-nonce');
    const number = await numberOf(groupId);
    const before = sentMail.sent.length;

    const match = await lookup({ number, email: 'ANA@correo.com' });
    const miss = await lookup({ number, email: 'someone@else.com' });
    const unknown = await lookup({ number: 'ZZZZ-ZZZZ', email: 'a@b.c' });

    expect(match.status).toBe(202);
    for (const answer of [miss, unknown]) {
      expect(answer.status).toBe(202);
      expect(JSON.stringify(answer.data)).toBe(JSON.stringify(match.data));
    }
    const mails = sentMail.sent.slice(before);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.to).toBe('ana@correo.com');
  });

  it('mails once per interval, however often it is asked', async () => {
    const groupId = await checkout('lookup-nonce');
    const number = await numberOf(groupId);
    const before = sentMail.sent.length;

    await lookup({ number, email: 'ana@correo.com' });
    await lookup({ number, email: 'ana@correo.com' });

    expect(sentMail.sent.length - before).toBe(1);
  });

  it('refuses the coordinator’s token, a session and no token at all', async () => {
    const body = { number: 'ZZZZ-ZZZZ', email: 'a@b.c' };

    const coordinator = await lookup(body, {
      'x-crossing-token': E2E_CROSSING_TOKEN,
      Authorization: undefined,
    });
    const session = await lookup(body, {
      ...storefront(),
      Authorization: await bearerFor(['admin']),
    });
    const none = await lookup(body, { Authorization: undefined });

    expect([coordinator.status, session.status, none.status]).toEqual([
      401, 401, 401,
    ]);
  });

  it('is not a key the storefront can turn anywhere else', async () => {
    const groupId = await checkout('other-nonce');

    const res = await mailReceipt(groupId, {
      ...storefront(),
      'idempotency-key': `"${crypto.randomUUID()}"`,
    });

    expect(res.status).toBe(401);
  });
});
