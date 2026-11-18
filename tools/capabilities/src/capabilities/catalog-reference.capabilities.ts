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
  // Plan 1.17 (#641): the operator authors the device models a product may
  // fit, in the platform plane; the vendor's specification names them.
  // Authoring is CRUD under `super-admin`'s `*:*:*` alone, as for a brand, and
  // a CRUD entry needs a grant that names it, so only the verbs are written.
  {
    id: 'catalog-reference:device-model:retire',
    oda: 'TMFC001',
    entities: ['catalog-reference:device-model'],
    permissions: ['catalog-reference:device-model:retire'],
    screens: ['master:device-model'],
    status: 'implemented',
    verticals: ['phone-accessories'],
  },
  {
    id: 'catalog-reference:device-model:restore',
    oda: 'TMFC001',
    entities: ['catalog-reference:device-model'],
    permissions: ['catalog-reference:device-model:restore'],
    screens: ['master:device-model'],
    status: 'implemented',
    verticals: ['phone-accessories'],
  },
];
