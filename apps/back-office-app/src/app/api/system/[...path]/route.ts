import { createConfigProxyRoute } from '@r10c/shells-next-system-management/server';

/**
 * Same-origin proxy for config-service, so the browser's configuration adapters
 * carry the `r10c_at` cookie. Mounted at `/api/system` rather than `/api/config`,
 * which is already this app's own configuration *fetch* route.
 *
 * It grants nothing: config-service still verifies the token and applies
 * `requirePermission('config:configuration:…')`.
 */
const forward = createConfigProxyRoute();

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
