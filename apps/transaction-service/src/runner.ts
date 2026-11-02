import { makeWorker } from '@entifix/service-shell/runtime';
import { makeRunnerLayer } from '@r10c/shells-effect-transaction';

import { DEFAULT_PORT } from './index';

/**
 * A further runner of transaction-service's flow engine (ADR 0066): no HTTP,
 * its shards assigned in the `workflow` store beside replica 0's, so a runner
 * dying is the normal case the engine runs under. Its runner port derives
 * from the service port and `WORKFLOW_REPLICA` (default 1) — `35103` here.
 */
makeWorker({
  appLayer: makeRunnerLayer({
    servicePort: Number(process.env.PORT) || DEFAULT_PORT,
    replica: Number(process.env.WORKFLOW_REPLICA) || 1,
  }),
});
