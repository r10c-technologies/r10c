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
    // Freeze a version in design; the version it replaces retires (ADR 0079 §1).
    {
      id: 'product-configuration-management:product-specification:release',
      oda: 'TMFC001',
      entities: ['product-configuration-management:product-specification'],
      permissions: [
        'product-configuration-management:product-specification:release',
      ],
      screens: ['master:product-specification'],
      status: 'implemented',
      verticals: 'all',
    },
    // Open the next version of an active one, in design.
    {
      id: 'product-configuration-management:product-specification:revise',
      oda: 'TMFC001',
      entities: ['product-configuration-management:product-specification'],
      permissions: [
        'product-configuration-management:product-specification:revise',
      ],
      screens: ['master:product-specification'],
      status: 'implemented',
      verticals: 'all',
    },
    // Withdraw the active version with no successor.
    {
      id: 'product-configuration-management:product-specification:retire',
      oda: 'TMFC001',
      entities: ['product-configuration-management:product-specification'],
      permissions: [
        'product-configuration-management:product-specification:retire',
      ],
      screens: ['master:product-specification'],
      status: 'implemented',
      verticals: 'all',
    },
    // Mark a retired version nothing published sells.
    {
      id: 'product-configuration-management:product-specification:obsolete',
      oda: 'TMFC001',
      entities: ['product-configuration-management:product-specification'],
      permissions: [
        'product-configuration-management:product-specification:obsolete',
      ],
      screens: ['master:product-specification'],
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
    // ADR 0082 §3: what one of an offering is, until its first publication.
    {
      id: 'product-configuration-management:product-offering:set-sale-unit',
      oda: 'TMFC001',
      entities: ['product-configuration-management:product-offering'],
      permissions: [
        'product-configuration-management:product-offering:set-sale-unit',
      ],
      screens: ['master:product-offering'],
      status: 'implemented',
      verticals: ['hardware', 'shoemaking-supplies'],
    },
  ];
