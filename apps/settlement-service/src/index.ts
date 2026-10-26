export { AppLayer, SETTLEMENT_SLICE } from './mongo';
export { router } from './routes';

export const SERVICE_NAME = '@r10c/settlement-service';

/**
 * `310N`, domain index 7 — the fleet's backend convention
 * (`docs/_shared/ports.md`). Reserved by ADR 0022 and claimed by the commit that
 * wrote the `settlement` store.
 */
export const DEFAULT_PORT = 3107;
