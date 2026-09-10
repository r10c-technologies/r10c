import { SalesChannel } from '@r10c/business-ts-sales-management';
import { envelopeEntityName } from '@r10c/entifix-ts-core';

/** The channel collection, matching `@entity({ key })`. */
export const SALES_CHANNEL_COLLECTION = envelopeEntityName(SalesChannel);
