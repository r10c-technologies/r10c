import { makeAppLayer } from '@r10c/shells-effect-settlement';

import { seedSettlement } from './seed';

export { router, SETTLEMENT_SLICE } from '@r10c/shells-effect-settlement';

/** The slice's composition, as the service mounts it, with its seed. */
export const AppLayer = makeAppLayer({ seed: seedSettlement });

export const SERVICE_NAME = '@r10c/settlement-service';

/**
 * `310N`, domain index 7 — the fleet's backend convention
 * (`docs/_shared/ports.md`). Reserved by ADR 0022 and claimed by the commit that
 * wrote the `settlement` store.
 */
export const DEFAULT_PORT = 3107;
