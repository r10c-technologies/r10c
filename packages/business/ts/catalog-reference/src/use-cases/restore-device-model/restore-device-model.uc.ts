import { permissionForUseCase } from '@entifix/authz';
import { useCase } from '@entifix/core';
import { InvalidBody, SelectionTooLarge } from '@r10c/business-ts-common';

import { DeviceModel } from '../../entities/device-model';
import { retireReferences } from '../retire-reference';

/**
 * Put a set of retired device models back into the pickers — the bulk bar's
 * other half of retiring, as for a brand.
 */
@useCase({
  entity: DeviceModel,
  key: 'restore',
  binding: 'collection',
  placement: 'context-dependent',
  labelKey: 'entity:device-model.useCases.restore',
  errors: [InvalidBody, SelectionTooLarge],
})
export class RestoreDeviceModelUC {
  static run() {
    return retireReferences;
  }
}

/** The permission this use case derives. Import it; never retype the verb. */
export const RESTORE_DEVICE_MODEL = permissionForUseCase(RestoreDeviceModelUC);
