import { createServiceProxyRoute } from '@r10c/shells-next-common/server';

/**
 * Same-origin proxy for marketplace-admin-service — the catalog a vendor
 * authors, which since ADR 0022 means `ProductSpecification` and nothing else.
 * Brands and categories moved to marketplace-service and go through
 * `/api/marketplace`.
 *
 * It grants nothing: the service still verifies the forwarded token and applies
 * `requirePermission('product-configuration-management:…')`.
 */
const forward = createServiceProxyRoute({
  baseUrl: process.env.MARKETPLACE_ADMIN_SERVICE_URL ?? 'http://localhost:3101',
});

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
