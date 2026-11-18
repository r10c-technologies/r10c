import { describe, expect, it } from 'vitest';

import {
  DEVICE_MODEL_UNIVERSAL_NOT_ALONE,
  deviceModelFitRefusal,
  DeviceModelUniversalNotAlone,
  readDeviceModelIds,
  UNIVERSAL_DEVICE_MODEL,
} from './device-model-fit.js';

describe('deviceModelFitRefusal', () => {
  it.each([
    ['nothing stated', undefined],
    ['an empty list', []],
    ['universal alone', [UNIVERSAL_DEVICE_MODEL]],
    ['specific models', ['dm-1', 'dm-2']],
  ])('accepts %s', (_label, ids) => {
    expect(deviceModelFitRefusal(ids)).toBeUndefined();
  });

  it('refuses universal beside a specific model', () => {
    expect(deviceModelFitRefusal(['dm-1', UNIVERSAL_DEVICE_MODEL])).toBe(
      DEVICE_MODEL_UNIVERSAL_NOT_ALONE,
    );
  });
});

describe('DeviceModelUniversalNotAlone', () => {
  it('carries the errors catalog code and says why', () => {
    const failure = new DeviceModelUniversalNotAlone();

    expect(failure.code).toBe(DEVICE_MODEL_UNIVERSAL_NOT_ALONE);
    expect(failure.message).toContain('universal');
  });
});

describe('readDeviceModelIds', () => {
  it('keeps non-empty strings once each, in order', () => {
    expect(readDeviceModelIds(['dm-1', '', 7, null, 'dm-2', 'dm-1'])).toEqual([
      'dm-1',
      'dm-2',
    ]);
  });

  // An empty list is a slot that claims to hold something (ADR 0049), and
  // anything not an array is a member the payload never carried.
  it.each([
    ['an empty list', []],
    ['a list of nothing usable', ['', 3]],
    ['null', null],
    ['a string', 'dm-1'],
    ['absent', undefined],
  ])('reads %s as absent', (_label, value) => {
    expect(readDeviceModelIds(value)).toBeUndefined();
  });
});
