import { makeService } from '@entifix/service-shell/runtime';
import {
  endpoints,
  makeAppLayer,
  policy,
} from '@r10c/shells-effect-transaction';
import { fleetToken } from '@r10c/utils-ts-fleet';

import { DEFAULT_PORT, SERVICE_NAME } from './index';

/**
 * transaction-service — the flow coordinator (port 3103).
 *
 * It starts flows: `POST /api/flow/checkout` and `/api/flow/cancellation`
 * compose a slip from what they verified and hand it to the durable flow
 * engine over the Postgres `workflow` store, answering `202` (ADR 0066). This
 * process is the engine's replica 0, whose runner listens on
 * `runnerPort(port, 0)`; `runner.ts` is the replica beside it.
 *
 * It hosts **no domain** (`domains: []`): orchestration is a mechanism, and a
 * domain name is simultaneously a package identity, a permission namespace and
 * an entitlement key — none of which anything would ever be provisioned for
 * here (ADR 0039).
 */
const port = Number(process.env.PORT) || DEFAULT_PORT;

makeService({
  name: SERVICE_NAME,
  port,
  slices: ['transaction'],
  description: fleetToken,
  endpoints,
  policy,
  appLayer: makeAppLayer(port),
});
