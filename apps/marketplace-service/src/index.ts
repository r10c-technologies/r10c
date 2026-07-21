import { HttpRouter } from '@effect/platform';
import { Layer } from 'effect';

/**
 * The service as a *composable definition*, separate from `main.ts` which boots
 * it. `main.ts` stays the webpack entry point; this barrel is what lets the e2e
 * `mock` profile launch the SAME router in-process, rather than re-declaring a
 * stand-in that could drift from the real route surface.
 *
 * Foundation shell for now: `/api/health` only, added by the service base.
 */
export const router = HttpRouter.empty;

export const AppLayer = Layer.empty;

export const SERVICE_NAME = '@r10c/marketplace-service';

/** The `310N` convention: marketplace is domain index 0. */
export const DEFAULT_PORT = 3100;
