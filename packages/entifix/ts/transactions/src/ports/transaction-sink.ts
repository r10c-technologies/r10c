import { Context } from 'effect';

/**
 * A write the browser has started and the server has not finished.
 *
 * The `transactionId` is also the stored entity's id — ADR 0028 makes the
 * client's minted id the primary key — so this is enough to find the record
 * later without holding a copy of it.
 */
export interface PendingTransaction {
  readonly transactionId: string;
  /** The target entity's `key`, so a settle knows which query scope to refresh. */
  readonly entity: string;
  /** ISO-8601, when the `202` came back. Drives the oldest-first eviction. */
  readonly at: string;
}

/** A pending write, plus what reconciliation has since learned about it. */
export type PendingEntry = PendingTransaction & {
  readonly state: 'pending' | 'failed';
  /**
   * Free text from whatever threw, in whatever language it was written in.
   *
   * ⚠️ Diagnostic only — never the headline of anything a user reads. A
   * transaction's failure carries no error *code*, so the message shown has to
   * be a catalog key and this is the detail beside it (ADR 0043's residual).
   */
  readonly reason?: string;
};

/**
 * How a transactional write announces itself to whoever is watching.
 *
 * The save adapter is the only place that knows a create went out as a command
 * rather than as a plain `POST`, and it learns nothing back — the `202`
 * describes a transaction, not an entity. So it tells this port, and the browser
 * takes it from there.
 *
 * Framework-free and synchronous on purpose: the implementation is a React store
 * action, and keeping that behind a port is what stops `entifix:transactions`
 * knowing anything about React or about where the pending set is persisted.
 */
export interface TransactionSink {
  began(pending: PendingTransaction): void;
}

/**
 * ⚠️ Read with `Effect.serviceOption`, never `yield*`.
 *
 * That keeps the tag out of the save adapter's `R`, so the storefront, the plain
 * REST adapters and every existing spec compile and run with no layer to
 * provide — an optional capability must not become a build break for callers
 * that will never want it.
 *
 * The cost of that erasure is that **nothing forces a composition root to
 * provide it**: forget to, and the read returns `None`, everything compiles, and
 * the feature is silently dead. A spec pins the one place that must
 * (`mergeContext`), because an invariant the compiler cannot hold is one a test
 * has to.
 */
export class TransactionSinkTag extends Context.Tag('TransactionSinkTag')<
  TransactionSinkTag,
  TransactionSink
>() {}

/**
 * The sink where nothing is watching — outside a mounted provider, and in every
 * caller that never opted into command creates.
 *
 * A create on a plain route still works exactly as it did; it simply gets no
 * optimistic treatment, which is an honest boundary rather than a write into an
 * unscoped store.
 */
export const NoopTransactionSink: TransactionSink = {
  began: () => undefined,
};

/**
 * The full view of the pending set, for the side that reconciles it.
 *
 * It extends {@link TransactionSink} because one store is behind both: the
 * adapter needs only `began`, and the settlement side needs to read entries and
 * retire them. Two interfaces rather than one because they are consumed from
 * opposite sides of a layer boundary — `entifix:react` may not import a shell,
 * so the store is handed in as a prop, the way `EntityDraftStore` already is for
 * autosave (ADR 0032).
 */
export interface PendingTransactionStore extends TransactionSink {
  readonly entries: readonly PendingEntry[];
  /** The write landed. Drop it; the server's copy is the truth now. */
  settle(transactionId: string): void;
  /** The write failed terminally. Keep it, marked, until it is dismissed. */
  fail(transactionId: string, reason?: string): void;
  /** The operator has read the failure. */
  dismiss(transactionId: string): void;
}
