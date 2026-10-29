import { Failure } from '@entifix/core';
import { Schema } from 'effect';

/**
 * A request whose body names something the domain does not accept — a
 * quantity that cannot be held, a payment for nothing, a reason no movement
 * has. Shared vocabulary rather than one class per domain because a failure's
 * code is permanent and names one failure: every domain that refuses a body
 * this way answers this one, with its own `reason`.
 */
export class InvalidBody extends Failure.invalid<InvalidBody>()(
  'InvalidBody',
  'invalidBody',
  { reason: Schema.String },
  { message: ({ reason }) => reason },
) {}
