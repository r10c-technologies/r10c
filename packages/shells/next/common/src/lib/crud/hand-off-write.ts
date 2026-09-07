import type { PendingTransactionStore } from '@r10c/entifix-transactions';

export interface HandOffWriteOptions {
  /** The saved record's id — the transaction id, for a tracked create. */
  readonly id: string;
  /** The record as the browser built it, shown until the service confirms. */
  readonly record: unknown;
  readonly pending: PendingTransactionStore;
  /** The draft the write was composed in, if it had one. */
  readonly draft?: { clear(): void };
}

/**
 * What happens to a draft once its write has been handed over.
 *
 * A transactional create resolves at the `202`, **before** the write is
 * durable, so the save adapter has already announced it and the id is in the
 * pending set ([ADR 0043](../../../../../../docs/adr/0043-the-optimistic-mutation-contract.md)).
 * Handing the record over *is* the question: the returned entity is otherwise
 * indistinguishable from a plain REST create, and asking `entries.some(...)`
 * beforehand would read a set captured before the `await` that announced it.
 *
 * ⚠️ A **still-pending write keeps its draft**. The write has not committed, and
 * a failure minutes from now would otherwise have destroyed the operator's only
 * copy of what they typed. Only a plain, committed write spends it.
 *
 * It lives here rather than inside `makeEntityCrud` because it is not the
 * generator's rule — it is the rule for every screen that writes. A wizard's
 * Finalizar performs the same three steps, and a second copy of them is where
 * one of the two would eventually stop keeping the draft.
 *
 * @returns whether the write is still in flight.
 */
export function handOffWrite({
  id,
  record,
  pending,
  draft,
}: HandOffWriteOptions): boolean {
  if (pending.attach(id, record)) return true;

  draft?.clear();
  return false;
}
