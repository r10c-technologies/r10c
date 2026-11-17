import type { Capability } from '../types.js';

export const catalogReferenceCapabilities: readonly Capability[] = [
  {
    id: 'catalog-reference:product-brand:retire',
    oda: 'TMFC001',
    entities: ['catalog-reference:product-brand'],
    permissions: ['catalog-reference:product-brand:retire'],
    screens: ['master:product-brand'],
    status: 'implemented',
    verticals: 'all',
  },
  {
    id: 'catalog-reference:product-brand:restore',
    oda: 'TMFC001',
    entities: ['catalog-reference:product-brand'],
    permissions: ['catalog-reference:product-brand:restore'],
    screens: ['master:product-brand'],
    status: 'implemented',
    verticals: 'all',
  },
  {
    id: 'catalog-reference:product-category:retire',
    oda: 'TMFC001',
    entities: ['catalog-reference:product-category'],
    permissions: ['catalog-reference:product-category:retire'],
    screens: ['master:product-category'],
    status: 'implemented',
    verticals: 'all',
  },
  {
    id: 'catalog-reference:product-category:restore',
    oda: 'TMFC001',
    entities: ['catalog-reference:product-category'],
    permissions: ['catalog-reference:product-category:restore'],
    screens: ['master:product-category'],
    status: 'implemented',
    verticals: 'all',
  },
  // Planned (plan 1.17): the operator authors the device models a product may
  // fit, in the platform plane. Nothing declares the entity yet.
  {
    id: 'catalog-reference:device-model:write',
    oda: 'TMFC001',
    entities: ['catalog-reference:device-model'],
    permissions: ['catalog-reference:device-model:write'],
    screens: ['master:device-model'],
    status: 'planned',
    verticals: ['phone-accessories'],
  },
];
