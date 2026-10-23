import {
  MEDIA_ALT_MISSING,
  MEDIA_NOT_HTTPS,
  MediaRefusedError,
} from '@r10c/business-ts-catalog-contracts';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { refuseSpecificationMedia } from './specification-media.js';

const refusal = (media: { url?: string; alt?: string }[] | undefined) => {
  const exit = Effect.runSyncExit(refuseSpecificationMedia({ media }));
  if (Exit.isSuccess(exit)) return undefined;
  const error = exit.cause.reasons[0];
  return error !== undefined && 'error' in error ? error.error : error;
};

describe('refuseSpecificationMedia', () => {
  it('lets a specification with no pictures through', () => {
    expect(refusal(undefined)).toBeUndefined();
  });

  it('lets https pictures with alt text through', () => {
    expect(
      refusal([{ url: 'https://cdn.example/a.jpg', alt: 'Front' }]),
    ).toBeUndefined();
  });

  it.each([
    [MEDIA_NOT_HTTPS, { url: 'http://cdn.example/a.jpg', alt: 'Front' }],
    [MEDIA_ALT_MISSING, { url: 'https://cdn.example/a.jpg', alt: '' }],
  ])('refuses with %s', (code, entry) => {
    const error = refusal([entry]);

    expect(error).toBeInstanceOf(MediaRefusedError);
    expect((error as MediaRefusedError).code).toBe(code);
  });
});
