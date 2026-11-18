import { Failure } from '@entifix/core';

/**
 * The reserved id a product states when it fits **every** phone — a cable, a
 * stand, a ring light. Explicit rather than "no models": an empty list means
 * the vendor has not said, and a buyer filtering by their phone should not be
 * shown a product nobody classified (plan 1.17, r10c #641).
 *
 * A reserved id inside the same list rather than a second member or a seeded
 * `DeviceModel` row: the storefront's condition stays one member,
 * `fitsDeviceModelIds=in=(<chosen>,universal)`, and the operator cannot retire
 * or rename what is a rule rather than a vocabulary entry.
 */
export const UNIVERSAL_DEVICE_MODEL = 'universal';

/** `universal` listed beside a specific model: the request is wrong. */
export const DEVICE_MODEL_UNIVERSAL_NOT_ALONE = 'deviceModelUniversalNotAlone';

/**
 * Why a list of fitted models may not be saved, or `undefined` when it may.
 * `universal` already covers every model, so listing it with another is a
 * contradiction the vendor has to resolve rather than one the service picks a
 * side of.
 */
export const deviceModelFitRefusal = (
  ids: readonly string[] | undefined,
): typeof DEVICE_MODEL_UNIVERSAL_NOT_ALONE | undefined =>
  ids !== undefined && ids.length > 1 && ids.includes(UNIVERSAL_DEVICE_MODEL)
    ? DEVICE_MODEL_UNIVERSAL_NOT_ALONE
    : undefined;

/** A specification listing `universal` beside a specific device model. */
export class DeviceModelUniversalNotAlone extends Failure.invalid<DeviceModelUniversalNotAlone>()(
  'DeviceModelUniversalNotAlone',
  DEVICE_MODEL_UNIVERSAL_NOT_ALONE,
  {},
  {
    message: () =>
      '"universal" fits every device model and cannot be listed with another',
  },
) {}

/**
 * Reads a list of device-model ids off a bus payload or a stored document.
 *
 * It **never rejects**, for the reason `readMedia` never does: a rejected
 * publication is poison. It keeps the non-empty strings, once each, and an
 * empty result is **absent** rather than `[]` (ADR 0049).
 */
export const readDeviceModelIds = (
  value: unknown,
): readonly string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  // `Array.from`, not a spread: SWC's loose mode miscompiles `[...new Set()]`.
  const ids = Array.from(
    new Set(
      value.filter(
        (entry): entry is string => typeof entry === 'string' && entry !== '',
      ),
    ),
  );
  return ids.length > 0 ? ids : undefined;
};
