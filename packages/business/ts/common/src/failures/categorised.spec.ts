import { EntifixConnError, NotFound } from '@entifix/core';
import { Cause, Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { categorised } from './categorised.js';

describe('categorised', () => {
  it('lets a typed failure through as itself', async () => {
    const failure = new NotFound({ entity: 'x' });

    expect(
      await Effect.runPromise(Effect.flip(categorised(Effect.fail(failure)))),
    ).toBe(failure);
  });

  it('turns an uncategorised error into a defect, never a category', async () => {
    const exit = await Effect.runPromiseExit(
      categorised(Effect.fail(new EntifixConnError('legacy'))),
    );

    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
  });

  it('passes a success through untouched', async () => {
    expect(await Effect.runPromise(categorised(Effect.succeed(1)))).toBe(1);
  });
});
