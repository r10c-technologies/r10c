import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  refuseSelectionAbove,
  SelectionTooLarge,
} from './selection-too-large.js';

describe('SelectionTooLarge', () => {
  it('is an invalid request, naming the most one request takes', () => {
    expect(new SelectionTooLarge({ max: 200 })).toMatchObject({
      _tag: 'SelectionTooLarge',
      code: 'selectionTooLarge',
      category: 'invalid',
      max: 200,
      message: 'a bulk action takes at most 200 rows',
    });
  });
});

describe('refuseSelectionAbove', () => {
  it('lets a selection at the cap through, and refuses one past it', async () => {
    await expect(
      Effect.runPromise(refuseSelectionAbove(2, 2)),
    ).resolves.toBeUndefined();
    await expect(
      Effect.runPromise(Effect.flip(refuseSelectionAbove(2, 3))),
    ).resolves.toMatchObject({ code: 'selectionTooLarge', max: 2 });
  });
});
