import {
  type MediaReferenceValue,
  mediaRefusal,
  MediaRefusedError,
} from '@r10c/business-ts-catalog-contracts';
import { Effect } from 'effect';

/**
 * Refuses a specification whose media `mediaRefusal` would not accept.
 *
 * Run on **both** write paths, the `POST` command's accept phase and the
 * `PUT`. ADR 0061 puts the `https` check at the one place a URL enters, so a
 * create and an update must refuse alike, or the update is the way round it.
 */
export const refuseSpecificationMedia = (specification: {
  readonly media?: readonly Partial<MediaReferenceValue>[];
}): Effect.Effect<void, MediaRefusedError> => {
  const code = mediaRefusal(specification.media);
  return code === undefined
    ? Effect.void
    : Effect.fail(new MediaRefusedError(code));
};
