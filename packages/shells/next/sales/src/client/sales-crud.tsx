'use client';

import { SalesChannel } from '@r10c/business-ts-sales-management';
import { makeEntityMetadataSource } from '@r10c/entifix-ts-rest-client';
import type { EntityCrud } from '@r10c/shells-next-common';
import { makeEntityCrud } from '@r10c/shells-next-common';

import { SALES_CHANNEL_SURFACE } from '../sales-surfaces';
import { useSalesAdapters } from './sales-context';

/**
 * The channel screens, declared rather than written.
 *
 * `$metadata` is app-relative, so it travels through the host's own proxy and
 * carries the session cookie — the descriptor is filtered by the verified
 * principal, so a `user` sees the list without a Save and an `admin` sees both
 * (ADR 0026).
 */
const SALES_METADATA = makeEntityMetadataSource({
  url: name => `/api/sales/${name}/$metadata`,
});

/**
 * A vendor's selling channels.
 *
 * `status` is left editable on purpose, and it is the member that matters: a
 * channel is retired by moving it to `inactive` rather than by deleting it,
 * because every order placed through one keeps a copy of its name and type and
 * the vendor's own reporting still joins on the id. The Delete the descriptor
 * offers is for the channel nobody has sold through yet.
 */
export const salesChannelCrud: EntityCrud<SalesChannel> = makeEntityCrud(
  SalesChannel,
  {
    useAdapters: useSalesAdapters,
    basePath: SALES_CHANNEL_SURFACE.basePath,
    catalogKey: SALES_CHANNEL_SURFACE.entityKey,
    repository: 'salesChannelRest',
    configuration: 'configurationStore',
    // Server-assigned by the Mongo adapter on create, so asking a vendor to
    // type one would be asking for a value the service overwrites.
    hiddenFields: ['id'],
    metadataSource: SALES_METADATA,
  },
);

/**
 * Every generated sales screen, for the host's workspace registry to derive its
 * `master:` tabs from — the same list the nav and the search sources come from,
 * so a second sales entity is one `SalesSurface` and one `makeEntityCrud` call.
 */
export const SALES_CRUDS = [salesChannelCrud] as const;

export const SalesChannelListClientPage = salesChannelCrud.ListPage;
export const SalesChannelSingleViewClientPage = salesChannelCrud.SingleViewPage;
