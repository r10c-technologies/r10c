import { Failure } from '@entifix/core';
import { Schema } from 'effect';

/** Another write to this price landed between the read and the tier change. */
export class PriceChanged extends Failure.conflict<PriceChanged>()(
  'PriceChanged',
  'priceChanged',
  { id: Schema.String },
  {
    message: ({ id }) =>
      `price ${id} changed since it was read; reload it and try again`,
  },
) {}
