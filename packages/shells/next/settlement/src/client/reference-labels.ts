import type { ReferenceLabelRegistration } from '@entifix/business';
import { SettlementRun } from '@r10c/business-ts-settlement-management';

import { createClientAdapters } from './adapters/create-client-adapters';

/**
 * The settlement runs a payout's or a ledger line's `runId` points at, read
 * through this shell's `/api/settlement` adapter (entifix 0030).
 *
 * A run is named by its period, two dates no single member states, so it
 * declares no `labelMember` and a reference to one reads as entifix's
 * short-id fallback rather than its whole id. Registering it is what makes
 * the fallback apply.
 *
 * Exported for the host to list, never for another shell (ADR 0077).
 */
export const SETTLEMENT_REFERENCE_LABELS: readonly ReferenceLabelRegistration[] =
  [[SettlementRun, createClientAdapters().settlementRunRest]];
