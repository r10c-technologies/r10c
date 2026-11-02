import { Failure } from '@entifix/core';
import { Schema } from 'effect';

/**
 * A flow a step refused before its point of no return, with everything taken
 * given back. A conflict with the state the flow met — a line out of stock, a
 * refund declined — not the caller's mistake and not a fault: the starter can
 * act on it, and `refusedStep` says which step to read it as.
 */
export class SagaCompensated extends Failure.conflict<SagaCompensated>()(
  'SagaCompensated',
  'sagaCompensated',
  { sagaId: Schema.String, refusedStep: Schema.String },
  {
    message: ({ refusedStep }) =>
      `the flow was refused at '${refusedStep}' and everything it took was given back`,
  },
) {}

/**
 * A flow that failed past its point of no return and could neither roll
 * forward nor back. Something here is wrong and an operator has to look; the
 * resume sweep and its metric are where it surfaces.
 */
export class SagaStranded extends Failure.internal<SagaStranded>()(
  'SagaStranded',
  'sagaStranded',
  { sagaId: Schema.String },
  { message: ({ sagaId }) => `flow ${sagaId} stranded past its pivot` },
) {}
