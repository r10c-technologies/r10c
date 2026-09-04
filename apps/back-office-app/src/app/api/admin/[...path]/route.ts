import { createServiceProxyRoute } from '@r10c/shells-next-common/server';
import { MARKETPLACE_ADMIN_SERVICE_URL } from '@r10c/shells-next-marketplace-admin/server';

/**
 * Same-origin proxy for marketplace-admin-service — the catalog a vendor
 * authors, which since ADR 0022 means `ProductSpecification` and nothing else.
 * Brands and categories moved to marketplace-service and go through
 * `/api/marketplace`.
 *
 * It grants nothing: the service still verifies the forwarded token and applies
 * `requirePermission('product-configuration-management:…')`.
 */
/**
 * `GET /api/admin/transaction/events` is an open `text/event-stream`, so this
 * handler must never be treated as a static or cached response.
 */
export const dynamic = 'force-dynamic';

const forward = createServiceProxyRoute({
  baseUrl: MARKETPLACE_ADMIN_SERVICE_URL,
});

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
