import type { Capability } from '../types.js';

export const productConfigurationManagementCapabilities: readonly Capability[] =
  [
    {
      id: 'product-configuration-management:product-offering:publish',
      oda: 'TMFC001',
      entities: [
        'product-configuration-management:product-offering',
        'product-configuration-management:product-specification',
      ],
      permissions: [
        'product-configuration-management:product-offering:publish',
      ],
      screens: ['master:product-offering'],
      status: 'implemented',
      verticals: 'all',
    },
    {
      id: 'product-configuration-management:product-offering:unpublish',
      oda: 'TMFC001',
      entities: ['product-configuration-management:product-offering'],
      permissions: [
        'product-configuration-management:product-offering:unpublish',
      ],
      screens: ['master:product-offering'],
      status: 'implemented',
      verticals: 'all',
    },
    // Authoring an offering is plain CRUD, written here because the guides cite it.
    {
      id: 'product-configuration-management:product-offering:write',
      oda: 'TMFC001',
      entities: [
        'product-configuration-management:product-offering',
        'product-configuration-management:product-specification',
      ],
      permissions: ['product-configuration-management:product-offering:write'],
      screens: ['master:product-offering', 'wizard:product-setup'],
      status: 'implemented',
      verticals: 'all',
    },
    // In design (plan 1.21, ADR 0082): an offering is sold in a unit with a step.
    {
      id: 'product-configuration-management:product-offering:set-sale-unit',
      oda: 'TMFC001',
      entities: ['product-configuration-management:product-offering'],
      permissions: [
        'product-configuration-management:product-offering:set-sale-unit',
      ],
      screens: ['master:product-offering'],
      status: 'in-design',
      verticals: ['hardware', 'shoemaking-supplies'],
    },
    // In design (plan 1.17): a product names the device models it fits.
    {
      id: 'product-configuration-management:product-offering:set-device-fit',
      oda: 'TMFC001',
      entities: [
        'product-configuration-management:product-offering',
        'catalog-reference:device-model',
      ],
      permissions: [
        'product-configuration-management:product-offering:set-device-fit',
      ],
      screens: ['master:product-offering'],
      status: 'in-design',
      verticals: ['phone-accessories'],
    },
  ];
