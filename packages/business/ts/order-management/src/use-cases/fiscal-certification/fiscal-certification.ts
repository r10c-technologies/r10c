import type { StoreFault, Unavailable } from '@entifix/core';
import { Effect } from 'effect';

import type { ProductOrder } from '../../entities/product-order';
import {
  type CertifierAnswer,
  FiscalCertifierTag,
} from '../../ports/fiscal-certifier';
import { ProductOrderStoreTag } from '../../ports/product-order-store';

/** The reason recorded when the certifier did not answer at all. */
export const CERTIFIER_UNAVAILABLE = 'unavailable';

/** Why a document is voided: the sale it certified was cancelled. */
export const VOID_REASON = 'Venta cancelada';

/** What one fiscal pass did. */
export interface FiscalPass {
  readonly certified: number;
  readonly voided: number;
  readonly failed: number;
}

type Outcome = 'done' | 'failed' | 'skipped';

/**
 * One attempt on one order: claim it, ask the certifier, record the answer.
 * A refusal or a certifier that did not answer is recorded as the order's
 * `fiscalFailure` and nothing else — the order keeps its status, so the
 * payment stands (#668), and the next pass past the backoff tries again.
 */
const attempt = <A>(
  orderId: string,
  now: Date,
  retryBefore: Date,
  ask: (order: ProductOrder) => Effect.Effect<CertifierAnswer<A>, Unavailable>,
  record: (value: A) => Effect.Effect<boolean, StoreFault>,
) =>
  Effect.gen(function* () {
    const store = yield* ProductOrderStoreTag;
    const order = yield* store.claimFiscalAttempt(orderId, now, retryBefore);
    if (order === undefined) return 'skipped' as Outcome;
    const answer = yield* ask(order).pipe(
      Effect.catchTag('Unavailable', () =>
        Effect.succeed({
          _tag: 'rejected',
          reason: CERTIFIER_UNAVAILABLE,
        } as const),
      ),
    );
    if (answer._tag === 'rejected') {
      yield* store.recordFiscalFailure(orderId, answer.reason);
      return 'failed' as Outcome;
    }
    return ((yield* record(answer.value)) ? 'done' : 'skipped') as Outcome;
  });

/**
 * One pass of the fiscal sweep (ADR 0078 §6, Q12): certify the document of
 * every order paid for and not yet certified, and void the document of every
 * order cancelled after it was certified.
 *
 * One code path covers every way an order becomes paid — a capture, a cash
 * collection, a seller confirming a payment link — because it reads the
 * order's status rather than hearing each event. A document recorded on an
 * order cancelled while the certifier was answering is voided by the next
 * pass. Nothing is published: no slice subscribes to a fiscal document yet.
 */
export const certifyFiscalDocuments = (now: Date, retryBackoffMs: number) =>
  Effect.gen(function* () {
    const store = yield* ProductOrderStoreTag;
    const certifier = yield* FiscalCertifierTag;
    const retryBefore = new Date(now.getTime() - retryBackoffMs);
    const due = yield* store.fiscalDue(retryBefore);
    const tally = { certified: 0, voided: 0, failed: 0 };

    for (const orderId of due.certify) {
      const outcome = yield* attempt(
        orderId,
        now,
        retryBefore,
        order => certifier.certify(order, now),
        document => store.recordFiscalDocument(orderId, document),
      );
      if (outcome === 'done') tally.certified += 1;
      if (outcome === 'failed') tally.failed += 1;
    }
    for (const orderId of due.void) {
      const outcome = yield* attempt(
        orderId,
        now,
        retryBefore,
        order => certifier.void(order, VOID_REASON, now),
        annulment => store.recordFiscalVoid(orderId, annulment),
      );
      if (outcome === 'done') tally.voided += 1;
      if (outcome === 'failed') tally.failed += 1;
    }
    return tally as FiscalPass;
  });
