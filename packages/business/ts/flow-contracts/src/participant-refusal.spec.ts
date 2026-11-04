import { Exit, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { participantRefusal } from './participant-refusal.js';

describe('participantRefusal', () => {
  it('accepts the codes a participant answers, and no other', () => {
    const decode = Schema.decodeUnknownExit(
      participantRefusal(['insufficientStock']),
    );

    expect(
      Exit.isSuccess(
        decode({ code: 'insufficientStock', category: 'conflict' }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(decode({ code: 'other', category: 'conflict' })),
    ).toBe(true);
  });

  it('accepts no refusal at all from a participant that has none', () => {
    expect(
      Exit.isFailure(
        Schema.decodeUnknownExit(participantRefusal([]))({
          code: 'anything',
          category: 'invalid',
        }),
      ),
    ).toBe(true);
  });
});
