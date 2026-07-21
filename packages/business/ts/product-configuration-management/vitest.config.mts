import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/business-ts-product-configuration-management',
  root: __dirname,
  // TODO(coverage): remove once this package reaches 100%.
  thresholds: false,
});
