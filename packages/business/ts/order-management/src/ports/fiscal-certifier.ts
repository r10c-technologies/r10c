import type { Unavailable } from '@entifix/core';
import { Context, type Effect } from 'effect';

import type { ProductOrder } from '../entities/product-order';
import type { FiscalDocument, FiscalVoid } from '../values/fiscal-document';

/**
 * How a certification or an annulment went. A refusal is an answer, not a
 * failure: the certifier saw the document and said no, with its reason, and
 * asking again unchanged will be refused again. Only `Unavailable` — the
 * certifier did not answer — is worth another try.
 */
export type CertifierAnswer<A> =
  | { readonly _tag: 'done'; readonly value: A }
  | { readonly _tag: 'rejected'; readonly reason: string };

/**
 * The FEL certifier: the third party that signs a seller's document and
 * answers its authorization number (ADR 0078 §6, Q12 — order-service issues
 * it, behind this port, with a simulated adapter until a real certifier is
 * contracted).
 *
 * ⚠️ **The order id is the idempotency key.** A real certifier takes an
 * internal identifier so that the same document asked for twice is issued
 * once; two replicas, or a retry after a lost answer, must never issue two
 * DTEs for one sale. Both calls carry it, and an adapter must honour it.
 */
export interface FiscalCertifier {
  /** Certify the document for a paid `order`. */
  readonly certify: (
    order: ProductOrder,
    issuedAt: Date,
  ) => Effect.Effect<CertifierAnswer<FiscalDocument>, Unavailable>;
  /** Annul the document certified for `order`, which was cancelled. */
  readonly void: (
    order: ProductOrder,
    reason: string,
    voidedAt: Date,
  ) => Effect.Effect<CertifierAnswer<FiscalVoid>, Unavailable>;
}

export class FiscalCertifierTag extends Context.Service<
  FiscalCertifierTag,
  FiscalCertifier
>()('FiscalCertifierTag') {}
