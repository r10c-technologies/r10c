import { envelopeEntityName } from '@entifix/core';
import { SalesChannel } from '@r10c/business-ts-sales-management';

/** The channel collection, matching `@entity({ key })`. */
export const SALES_CHANNEL_COLLECTION = envelopeEntityName(SalesChannel);
