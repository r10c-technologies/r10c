import type { DomainRow } from './types.js';

/**
 * Each domain's ODA analog, written once (ADR 0080 §4).
 *
 * `BUSINESS-ARCHITECTURE.md`'s capability map is generated from this table by
 * `tools/sync-docs.mjs`, and every register entry's `oda` is checked against it,
 * so the two can no longer say different things. The plane and store columns of
 * the map come from the slice register instead: they are facts about stores.
 *
 * Sales and Stock are `null` for the reasons the capability map's prose records
 * (no ODA component was found in what is reachable), not because nobody looked.
 */
export const DOMAINS: readonly DomainRow[] = [
  {
    domain: 'party-management',
    capability: 'Party Management',
    oda: 'TMFC028',
    odaAnalog: 'Party Management (TMFC028)',
    packageName: 'business-ts-party-management',
  },
  {
    domain: 'access-management',
    capability: 'Access Management',
    oda: 'TMFC035',
    odaAnalog: 'Permissions Management (TMFC035)',
    packageName: 'business-ts-access-management',
  },
  {
    domain: 'config',
    capability: 'Configuration',
    oda: null,
    odaAnalog: '—',
    packageName: 'business-ts-configuration',
  },
  {
    domain: 'authn',
    capability: 'Identity & Sessions',
    oda: 'TMFC020',
    odaAnalog: 'Digital Identity Mgmt (TMFC020)',
    packageName: 'business-ts-authn',
  },
  {
    domain: 'product-configuration-management',
    capability: 'Product Configuration Mgmt',
    oda: 'TMFC001',
    odaAnalog: 'Product Catalog Mgmt (TMFC001), Product Configurator (TMFC027)',
    packageName: 'business-ts-product-configuration-management',
  },
  {
    domain: 'catalog-reference',
    capability: 'Catalog Reference',
    oda: 'TMFC001',
    odaAnalog: 'Product Catalog Mgmt (TMFC001), classification half',
    packageName: 'business-ts-catalog-reference',
  },
  {
    domain: 'marketplace-catalog',
    capability: 'Marketplace Catalog',
    oda: 'TMFC001',
    odaAnalog: 'Product Catalog Mgmt, published view',
    packageName: 'business-ts-marketplace-catalog',
  },
  {
    domain: 'marketplace-vendor',
    capability: 'Marketplace Vendor',
    oda: 'TMFC028',
    odaAnalog: 'Party Management (TMFC028), published view',
    packageName: 'business-ts-marketplace-vendor',
  },
  {
    domain: 'stock-management',
    capability: 'Stock Management',
    oda: null,
    odaAnalog: '— (no ODA analog)',
    packageName: 'business-ts-stock-management',
  },
  {
    domain: 'order-management',
    capability: 'Order Management',
    oda: 'TMFC002',
    odaAnalog: 'Product Order Capture & Validation (TMFC002)',
    packageName: 'business-ts-order-management',
  },
  {
    domain: 'payment-management',
    capability: 'Payment Management',
    oda: 'TMFC029',
    odaAnalog: 'Payment Management (TMFC029)',
    packageName: 'business-ts-payment-management',
  },
  {
    domain: 'settlement-management',
    capability: 'Settlement Management',
    oda: 'TMFC039',
    odaAnalog: 'Agreement Mgmt (TMFC039), partner revenue',
    packageName: 'business-ts-settlement-management',
  },
  {
    domain: 'sales-management',
    capability: 'Sales Management',
    oda: null,
    odaAnalog: '— (no ODA analog); SID Market/Sales, Sales Channel ABE',
    packageName: 'business-ts-sales-management',
  },
  {
    domain: 'shipping-order-management',
    capability: 'Fulfillment',
    oda: 'TMF700',
    odaAnalog: 'Shipping & Logistics (TMF700 Shipping Order)',
    packageName: 'business-ts-shipping-order-management',
  },
];
