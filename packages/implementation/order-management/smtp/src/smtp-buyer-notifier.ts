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

/**
 * Where the mail server listens, who the buyer's mail is from, and — for a
 * provider rather than the lab's Mailpit — the account it is sent as and
 * whether the hop must be encrypted (#692).
 */
export interface SmtpOptions {
  readonly host: string;
  readonly port: number;
  readonly from: string;
  /** Empty or absent: no authentication, as Mailpit takes none. */
  readonly user?: string;
  readonly password?: string;
  /** Upgrade to TLS with `STARTTLS` and refuse to send without it. */
  readonly tls?: boolean;
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
 * The transport's options. In the lab, Mailpit on `:30825`, which accepts
 * anything: no TLS, no authentication. A provider is the same rows with a
 * user, a password and `tls` (#692): GCP blocks port 25, so the cloud sends on
 * 587, where the connection starts plain and `STARTTLS` upgrades it —
 * `requireTLS` refuses to send a password, or a buyer's mail, over a hop that
 * did not upgrade.
 */
export const transportOptionsOf = ({
  host,
  port,
  user,
  password,
  tls,
}: Omit<SmtpOptions, 'from'>) => ({
  host,
  port,
  secure: false,
  requireTLS: tls === true,
  ...(user === undefined || user === ''
    ? {}
    : { auth: { user, pass: password ?? '' } }),
});

/** A nodemailer transport over {@link transportOptionsOf}. */
export const makeSmtpTransport = (
  options: Omit<SmtpOptions, 'from'>,
): MailTransport => createTransport(transportOptionsOf(options));

/** The buyer notifier order-service composes, built once at boot. */
export const smtpBuyerNotifierLayer = (options: SmtpOptions) =>
  Layer.effect(
    BuyerNotifierTag,
    Effect.sync(() =>
      smtpBuyerNotifier(makeSmtpTransport(options), options.from),
    ),
  );
