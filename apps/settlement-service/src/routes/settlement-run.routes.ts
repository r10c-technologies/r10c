import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { SettlementRun } from '@r10c/business-ts-settlement-management';
import {
  MongoClientTag,
  MongoDatabaseTag,
} from '@r10c/entifix-ts-mongo-client';
import { entityMetadataRoute } from '@r10c/shells-effect-service';
import { Effect } from 'effect';

import { settleOnce } from '../run/sweep';
import { byIdRoute, guarded, listRoute, serverError } from './entity-crud';

/**
 * Settle everything unsettled, now.
 *
 * ⚠️ **The same pass the daemon runs, not a second implementation.** A route
 * that settled differently from the sweep would make a live verification prove
 * something about a code path nothing else takes.
 *
 * ⚠️ **It answers `200` with nothing settled rather than an error.** A period
 * with no unsettled entries in it is the normal state of a system that has just
 * settled, not a failed request — and a caller that has to distinguish "nothing
 * to do" from "it broke" by reading a status code will eventually read it wrong.
 *
 * It exists because the alternative is waiting out an interval: verifying the
 * fold live means ringing up a sale and seeing the payout, and a dial set low
 * enough to make that quick is a dial that is wrong for the lab afterwards.
 */
const settleNowRoute = Effect.gen(function* () {
  const client = yield* MongoClientTag;
  const db = yield* MongoDatabaseTag;
  const outcome = yield* settleOnce(client, db);
  return yield* HttpServerResponse.json({
    meta: { type: 'settlementRun' },
    data: outcome,
  });
}).pipe(Effect.catchAll(serverError));

/**
 * The periodic batch a payout belongs to.
 *
 * ⚠️ **These two reads are deliberately *not* scoped**, and the exception is
 * worth stating because everything else in this service is. A `SettlementRun`
 * carries a period and a status and no `vendorId` — there is nothing on it that
 * belongs to one vendor, and nothing on it that discloses another's terms or
 * takings. A vendor reading "the March run, calculated" learns only which batch
 * their own payout came from, which is the question a statement raises.
 *
 * The absence of a predicate here is therefore a property of the record rather
 * than a gap: a scope over a member the entity does not have would have to be
 * invented, and inventing one is how a filter ends up narrowing nothing while
 * looking like it does.
 *
 * ⚠️ **`POST` is guarded by `settlement-run:write`, which no role holds.**
 * Opening a run moves money for every vendor on the platform at once, which is
 * not a tenant-scoped act in any sense — an `admin` reaching it would be
 * settling other organizations. `super-admin`'s wildcard covers it, and the
 * daemon beside it needs no permission at all because it is not a request.
 *
 * ⚠️ **`$metadata` before `/:id`**, for the routing reason named on the
 * agreement routes.
 */
export const settlementRunRoutes = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/api/settlement-run',
    guarded(SettlementRun, 'read', () => listRoute(SettlementRun)),
  ),
  HttpRouter.get(
    '/api/settlement-run/$metadata',
    entityMetadataRoute(SettlementRun),
  ),
  HttpRouter.get(
    '/api/settlement-run/:id',
    guarded(SettlementRun, 'read', () => byIdRoute(SettlementRun)),
  ),
  HttpRouter.post(
    '/api/settlement-run',
    guarded(SettlementRun, 'write', () => settleNowRoute),
  ),
);
