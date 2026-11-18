import {
  deviceModelFitRefusal,
  DeviceModelUniversalNotAlone,
  type MediaReferenceValue,
  mediaRefusal,
  type MediaRefused,
  mediaRefused,
} from '@r10c/business-ts-catalog-contracts';
import { Effect } from 'effect';

/**
 * Refuses a specification whose media `mediaRefusal` would not accept.
 *
 * Run on **both** write paths, the `POST` create and the `PUT`. ADR 0061 puts the `https` check at the one place a URL enters, so a
 * create and an update must refuse alike, or the update is the way round it.
 */
export const refuseSpecificationMedia = (specification: {
  readonly media?: readonly Partial<MediaReferenceValue>[];
}): Effect.Effect<void, MediaRefused> => {
  const code = mediaRefusal(specification.media);
  return code === undefined ? Effect.void : Effect.fail(mediaRefused(code));
};

/**
 * Refuses a specification listing `universal` beside a specific device model.
 * Run on both write paths beside {@link refuseSpecificationMedia}, for the same
 * reason: an update must not be the way round a rule the create keeps.
 */
export const refuseSpecificationFits = (specification: {
  readonly fitsDeviceModelIds?: readonly string[];
}): Effect.Effect<void, DeviceModelUniversalNotAlone> =>
  deviceModelFitRefusal(specification.fitsDeviceModelIds) === undefined
    ? Effect.void
    : Effect.fail(new DeviceModelUniversalNotAlone());
