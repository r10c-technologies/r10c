import type {
  EntityFieldDescriptor,
  EntityRowDraft,
} from '@r10c/entifix-ts-core';
import type { ReactNode } from 'react';

export interface EntityDetailGridProps {
  /**
   * The owning member's descriptor. Its `childType` supplies the columns and
   * its `label` names the grid, so an entity that declares an owned collection
   * needs no per-entity component.
   */
  descriptor: EntityFieldDescriptor;
  /** The rows, as the master's draft holds them. */
  rows: readonly EntityRowDraft[];
  /**
   * The whole list changed. One callback rather than add/remove/change,
   * because the master's draft holds the rows as a single `JsonValue` and the
   * grid is controlled from above exactly as `EntityForm` is — the form owns
   * the draft, the grid renders it.
   */
  onRowsChange: (rows: readonly EntityRowDraft[]) => void;

  /**
   * Per-cell messages, keyed by `rowFieldPath` — `items[2].quantity`.
   *
   * The same map `EntityForm` is handed, unfiltered: the grid picks out the
   * keys that name its own member rather than the caller splitting them, so a
   * form with two owned collections needs no bookkeeping.
   */
  errors?: Record<string, string>;

  /** Read mode shows values; edit mode shows inputs. */
  editing?: boolean;

  isLoading?: boolean;
  /**
   * What holds the grid's shape while the record is in flight.
   *
   * `true` (the default) renders the built-in placeholder, derived from the
   * grid's own resolved column count so the swap to real rows shifts nothing. A
   * node replaces that default; `false` renders no placeholder at all.
   */
  skeleton?: boolean | ReactNode;

  /**
   * A derived row under the grid — an order's total, a count.
   *
   * A **slot**, because an aggregate cannot come from metadata: summing
   * `OrderItem.amount` is wrong (minor units, and several currencies once a
   * basket spans vendors) and summing `quantity` across offerings means
   * nothing. The control renders what it is given and invents no arithmetic.
   */
  footer?: (rows: readonly EntityRowDraft[]) => ReactNode;

  className?: string;
}
