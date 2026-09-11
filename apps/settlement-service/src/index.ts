export { AppLayer } from './mongo';
export { SETTLEMENT_SLICE } from './outbox';
export { router } from './routes';
export {
  AGREEMENT_COLLECTION,
  COMMISSION_ENTRY_COLLECTION,
  SETTLEMENT_RUN_COLLECTION,
  VENDOR_PAYOUT_COLLECTION,
} from './settlement-index';

export const SERVICE_NAME = '@r10c/settlement-service';

/**
 * `310N`, domain index 7 — the fleet's backend convention
 * (`docs/_shared/ports.md`). Reserved by ADR 0022 and claimed by the commit that
 * wrote the `settlement` store.
 */
export const DEFAULT_PORT = 3107;
