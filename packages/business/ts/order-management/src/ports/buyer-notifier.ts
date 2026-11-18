import type { Unavailable } from '@entifix/core';
import { Context, type Effect } from 'effect';

/** One message to a storefront buyer: a plain-text body and an HTML one. */
export interface BuyerMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/**
 * How order-management reaches an anonymous buyer: email is the one channel
 * the platform has for someone with no account (ADR 0076 §6). Sends one
 * message or fails `Unavailable`; the flow step that sends retries, and a
 * retry draws a fresh access link, so delivery is at-least-once.
 */
export interface BuyerNotifier {
  readonly send: (mail: BuyerMail) => Effect.Effect<void, Unavailable>;
}

export class BuyerNotifierTag extends Context.Service<
  BuyerNotifierTag,
  BuyerNotifier
>()('BuyerNotifierTag') {}
