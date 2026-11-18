import { permissionForUseCase } from '@entifix/authz';
import { useCase } from '@entifix/core';
import { InvalidBody, SelectionTooLarge } from '@r10c/business-ts-common';

import { DeviceModel } from '../../entities/device-model';
import { retireReferences } from '../retire-reference';

/**
 * Take a set of device models out of the pickers — nobody sells for that phone
 * any more — while every offering that already names one keeps resolving.
 * The same shared run, binding and confirmation as retiring a brand; see
 * `RetireProductBrandUC` for why each is what it is.
 */
@useCase({
  entity: DeviceModel,
  key: 'retire',
  binding: 'collection',
  placement: 'context-dependent',
  labelKey: 'entity:device-model.useCases.retire',
  confirm: {
    tone: 'destructive',
    messageKey: 'entity:device-model.useCases.retireConfirm',
  },
  reversible: 'undo',
  inverse: 'restore',
  errors: [InvalidBody, SelectionTooLarge],
})
export class RetireDeviceModelUC {
  static run() {
    return retireReferences;
  }
}

/** The permission this use case derives. Import it; never retype the verb. */
export const RETIRE_DEVICE_MODEL = permissionForUseCase(RetireDeviceModelUC);
