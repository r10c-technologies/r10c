import { Failure } from '@entifix/core';
import { Schema } from 'effect';

/**
 * One vendor's lines in two currencies, on one order or in one run. There is
 * no exchange rate in this system, so a subtotal across them would be a number
 * that means nothing — and the ledger is built to be defensible in a dispute.
 * Invalid rather than transient: a redelivery carries the same lines, so the
 * bus quarantines the message instead of retrying it.
 */
export class MixedCurrencies extends Failure.invalid<MixedCurrencies>()(
  'MixedCurrencies',
  'mixedCurrencies',
  {
    vendorId: Schema.String,
    currencies: Schema.Array(Schema.String),
  },
  {
    message: ({ vendorId, currencies }) =>
      `vendor ${vendorId} has amounts in ${currencies.join(' and ')} together`,
  },
) {}
