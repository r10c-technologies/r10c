import { HttpRouter } from '@effect/platform';
import {
  isSalesChannelStatus,
  isSalesChannelType,
  SalesChannel,
} from '@r10c/business-ts-sales-management';
import { EntifixBuildError } from '@r10c/entifix-ts-core';
import { entityMetadataRoute } from '@r10c/shells-effect-service';

import {
  byIdRoute,
  deleteRoute,
  guarded,
  listRoute,
  saveRoute,
} from './entity-crud';

/**
 * A vendor's own selling channels — tenant plane, so every route goes through
 * `guarded`, which checks the permission the entity derives *and* binds the
 * request to the caller's organization database.
 *
 * ⚠️ **`DELETE` is served, and `status` is still the way a channel retires.**
 * Every order placed through a channel keeps a copy of its name and type, so
 * deleting one loses nothing on a receipt — but it does lose the record a
 * vendor's own reporting joins against, which is why `SalesChannelStatuses`
 * carries `inactive` and the screens offer that first
 * ([ADR 0024](../../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)).
 * The route exists for the mistyped channel nobody has sold through yet.
 *
 * `$metadata` stays a **literal path registered before `:id`**: as
 * `/api/sales-channel/:id` it would shadow the document and silently never run,
 * which reads as "this entity has no metadata". It describes the *model* rather
 * than tenant data, so it resolves no tenant handle and must not answer `409` to
 * a principal who has not picked an organization yet (ADR 0026).
 */
/**
 * The two closed sets, checked where the deserializer does not check them.
 *
 * A `type` outside `SalesChannelTypes` is the failure the shared vocabulary
 * package exists to prevent arriving by drift; letting one in through a request
 * body would reopen it from the other end. A `status` outside its set is milder
 * — it makes a channel neither active nor retired — and is refused in the same
 * breath rather than left as the one unchecked member.
 */
const validateChannel = (channel: SalesChannel): EntifixBuildError | undefined =>
  !isSalesChannelType(channel.type)
    ? new EntifixBuildError(
        `A sales channel type must be one of the declared types, not "${String(channel.type)}"`,
      )
    : !isSalesChannelStatus(channel.status)
      ? new EntifixBuildError(
          `A sales channel status must be active or inactive, not "${String(channel.status)}"`,
        )
      : undefined;

export const salesChannelRoutes = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/api/sales-channel',
    guarded(SalesChannel, 'read', () => listRoute(SalesChannel)),
  ),
  HttpRouter.get(
    '/api/sales-channel/$metadata',
    entityMetadataRoute(SalesChannel),
  ),
  HttpRouter.get(
    '/api/sales-channel/:id',
    guarded(SalesChannel, 'read', () => byIdRoute(SalesChannel)),
  ),
  HttpRouter.post(
    '/api/sales-channel',
    guarded(SalesChannel, 'write', () =>
      saveRoute(SalesChannel, { fromParams: false, validate: validateChannel }),
    ),
  ),
  HttpRouter.put(
    '/api/sales-channel/:id',
    guarded(SalesChannel, 'write', () =>
      saveRoute(SalesChannel, { fromParams: true, validate: validateChannel }),
    ),
  ),
  HttpRouter.del(
    '/api/sales-channel/:id',
    guarded(SalesChannel, 'delete', () => deleteRoute(SalesChannel)),
  ),
);
