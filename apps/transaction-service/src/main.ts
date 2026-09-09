import { makeService } from '@r10c/shells-effect-service';

import { DEFAULT_PORT, SERVICE_NAME } from './index';
import { AppLayer } from './mongo';
import { router } from './routes';

/**
 * transaction-service — the saga coordinator (port 3103).
 *
 * Owns the `saga` store: control plane, single, one Mongo database. It folds
 * `transaction.*` events into the record a browser polls after its `202`, and
 * it orchestrates multi-step flows from declarative definitions.
 *
 * It hosts **no domain** (`domains: []`): orchestration is a mechanism, and a
 * domain name is simultaneously a package identity, a permission namespace and
 * an entitlement key — none of which anything would ever be provisioned for
 * here (ADR 0039).
 */
makeService({
  name: SERVICE_NAME,
  port: Number(process.env.PORT) || DEFAULT_PORT,
  slices: ['transaction'],
  router,
  appLayer: AppLayer,
});
