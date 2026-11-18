import { Unavailable } from '@entifix/core';
import {
  type BuyerMail,
  type BuyerNotifier,
  BuyerNotifierTag,
} from '@r10c/business-ts-order-management';
import { Effect, Layer } from 'effect';
import { createTransport } from 'nodemailer';

/** The one call this cell makes on its driver: hand a message to the server. */
export interface MailTransport {
  readonly sendMail: (message: {
    readonly from: string;
    readonly to: string;
    readonly subject: string;
    readonly text: string;
    readonly html: string;
  }) => Promise<unknown>;
}

/** Where the mail server listens, and who the buyer's mail is from. */
export interface SmtpOptions {
  readonly host: string;
  readonly port: number;
  readonly from: string;
}

/**
 * A {@link BuyerNotifier} over a mail transport: one `sendMail` per message,
 * and any failure of it answered `Unavailable` — the flow step that sends
 * retries, so a mail server that did not answer is a retry, never a defect.
 */
export const smtpBuyerNotifier = (
  transport: MailTransport,
  from: string,
): BuyerNotifier => ({
  send: (mail: BuyerMail) =>
    Effect.tryPromise({
      try: () => transport.sendMail({ from, ...mail }),
      catch: () => new Unavailable({ dependency: 'smtp' }),
    }).pipe(Effect.asVoid),
});

/**
 * A nodemailer transport for a plain SMTP server: in the lab, Mailpit on
 * `:30825`, which accepts anything and keeps it for the web UI. No TLS and no
 * authentication there; a production server is a configuration row away, and
 * an unencrypted hop to it is not something this cell decides.
 */
export const makeSmtpTransport = ({
  host,
  port,
}: Pick<SmtpOptions, 'host' | 'port'>): MailTransport =>
  createTransport({ host, port, secure: false });

/** The buyer notifier order-service composes, built once at boot. */
export const smtpBuyerNotifierLayer = (options: SmtpOptions) =>
  Layer.effect(
    BuyerNotifierTag,
    Effect.sync(() =>
      smtpBuyerNotifier(makeSmtpTransport(options), options.from),
    ),
  );
