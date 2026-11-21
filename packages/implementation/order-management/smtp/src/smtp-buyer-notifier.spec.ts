import {
  type BuyerMail,
  BuyerNotifierTag,
} from '@r10c/business-ts-order-management';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import {
  makeSmtpTransport,
  smtpBuyerNotifier,
  smtpBuyerNotifierLayer,
  transportOptionsOf,
} from './smtp-buyer-notifier.js';

const MAIL: BuyerMail = {
  to: 'ana@correo.com',
  subject: 'Tu pedido 7KQ4-M2XD',
  text: 'texto',
  html: '<p>texto</p>',
};

describe('smtpBuyerNotifier', () => {
  it('hands the message to the transport, from the configured sender', async () => {
    const sendMail = vi.fn(() => Promise.resolve({ messageId: 'm-1' }));

    await Effect.runPromise(
      smtpBuyerNotifier({ sendMail }, 'pedidos@r10c.test').send(MAIL),
    );

    expect(sendMail).toHaveBeenCalledWith({
      from: 'pedidos@r10c.test',
      ...MAIL,
    });
  });

  it('answers a transport that failed as unavailable, never a defect', async () => {
    const sendMail = () => Promise.reject(new Error('ECONNREFUSED'));

    const failure = await Effect.runPromise(
      Effect.flip(smtpBuyerNotifier({ sendMail }, 'x@r10c.test').send(MAIL)),
    );

    expect(failure).toMatchObject({ _tag: 'Unavailable', dependency: 'smtp' });
  });
});

describe('the smtp layer', () => {
  it('builds a transport for the server without dialling it', () => {
    const transport = makeSmtpTransport({ host: '127.0.0.1', port: 30825 });

    expect(typeof transport.sendMail).toBe('function');
  });

  it('authenticates and requires STARTTLS only when the rows ask for it', () => {
    expect(transportOptionsOf({ host: 'h', port: 30825 })).toEqual({
      host: 'h',
      port: 30825,
      secure: false,
      requireTLS: false,
    });
    expect(
      transportOptionsOf({ host: 'h', port: 587, user: '', tls: false }),
    ).not.toHaveProperty('auth');
    expect(
      transportOptionsOf({
        host: 'smtp.example.test',
        port: 587,
        user: 'u',
        password: 'p',
        tls: true,
      }),
    ).toEqual({
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'u', pass: 'p' },
    });
    expect(transportOptionsOf({ host: 'h', port: 1, user: 'u' })).toMatchObject(
      { auth: { user: 'u', pass: '' } },
    );
  });

  it('provides the notifier from the configured server', async () => {
    const notifier = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          return yield* BuyerNotifierTag;
        }),
        smtpBuyerNotifierLayer({
          host: '127.0.0.1',
          port: 30825,
          from: 'x@r10c.test',
        }),
      ),
    );

    expect(typeof notifier.send).toBe('function');
  });
});
