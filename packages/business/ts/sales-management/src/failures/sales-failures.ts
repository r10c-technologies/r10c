import { Failure } from '@entifix/core';
import { Schema } from 'effect';

/**
 * A sale through a retired channel. A channel is retired by state rather than
 * deleted, so it stays readable and pickable by anything that does not check.
 */
export class ChannelInactive extends Failure.conflict<ChannelInactive>()(
  'ChannelInactive',
  'channelInactive',
  { channelId: Schema.String },
  { message: () => 'a retired sales channel cannot take a sale' },
) {}

/**
 * An offering on the till that another vendor publishes. Refused before the
 * coordinator's crossing token is presented: by the reserve, this process
 * would already hold a token that can name any organization.
 */
export class OfferingNotYours extends Failure.forbidden<OfferingNotYours>()(
  'OfferingNotYours',
  'notYours',
  { offeringId: Schema.String },
  {
    message: ({ offeringId }) =>
      `the offering "${offeringId}" is not this organization's to sell`,
  },
) {}

/**
 * A line could not be held, and every hold the checkout took was given back.
 * An outcome the seller can act on — count the shelf — not a fault.
 */
export class StockUnavailable extends Failure.conflict<StockUnavailable>()(
  'StockUnavailable',
  'stockUnavailable',
  { channelId: Schema.String },
  {
    message: () =>
      'a line could not be held, and every hold taken was released',
  },
) {}
