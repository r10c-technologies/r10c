import { createServiceProxyRoute } from '@r10c/shells-next-common/server';

/**
 * Same-origin proxy for marketplace-service — the platform-plane vocabulary a
 * catalog is classified in: brands, categories and the characteristic
 * dictionary ([ADR 0022](../../../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 *
 * A second proxy rather than a second path on `/api/admin`, because these are
 * two backends owned by two slices. Reads there are unauthenticated by design —
 * the storefront serves anonymous traffic — so this proxy exists for the
 * *writes*, which the service gates on `catalog-reference:…:write`, and so the
 * browser never holds a real backend address either way.
 */
const forward = createServiceProxyRoute({
  baseUrl: process.env.MARKETPLACE_SERVICE_URL ?? 'http://localhost:3100',
});

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
