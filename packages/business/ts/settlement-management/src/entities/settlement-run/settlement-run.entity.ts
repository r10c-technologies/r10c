import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

import {
  type SettlementRunStatus,
  SettlementRunStatuses,
} from '../../values/settlement-run-status';

/**
 * One period's settlement: the batch that turns commission entries into vendor
 * payouts.
 *
 * A run is an **entity rather than a job invocation** because it has to be
 * answerable after the fact — which period, which state, and therefore which
 * payouts belong to it. A cron job that wrote payouts directly would leave no
 * record of what "the March run" meant once March's data changed.
 *
 * The `open` → `calculated` split is what makes a run re-runnable before money
 * moves: calculation is derived from the ledger and can be discarded, payment
 * cannot. Taking a distributed lock for the run is legitimate — it is exactly
 * the coarse operation `LockService` is for, unlike a per-product stock
 * decrement.
 *
 * Control plane, `settlement` store.
 */
@entity({
  domain: 'settlement-management',
  key: 'settlement-run',
  labelKey: 'entity:settlement-run.label',
  pluralKey: 'entity:settlement-run.plural',
})
export class SettlementRun implements Entity {
  // #region properties
  #id?: EntityId;
  #periodStart?: Date;
  #periodEnd?: Date;
  #status: SettlementRunStatus = 'open';
  // #endregion

  // #region constructors
  constructor(periodStart?: Date, periodEnd?: Date) {
    this.#periodStart = periodStart;
    this.#periodEnd = periodEnd;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:settlement-run.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'date',
    labelKey: 'entity:settlement-run.fields.periodStart',
    sortable: true,
    filterable: true,
  })
  get periodStart(): Date | undefined {
    return this.#periodStart;
  }
  set periodStart(value: Date | undefined) {
    this.#periodStart = value;
  }

  @accessor({
    type: 'date',
    labelKey: 'entity:settlement-run.fields.periodEnd',
    sortable: true,
    filterable: true,
  })
  get periodEnd(): Date | undefined {
    return this.#periodEnd;
  }
  set periodEnd(value: Date | undefined) {
    this.#periodEnd = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:settlement-run.fields.status',
    enumValues: SettlementRunStatuses,
    enumLabelKey: 'entity:settlement-run.values.status',
    required: true,
    filterable: true,
  })
  get status(): SettlementRunStatus {
    return this.#status;
  }
  set status(value: SettlementRunStatus) {
    this.#status = value;
  }
  // #endregion
}
