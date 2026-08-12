import { createConfigRoute } from '@r10c/shells-next-common/server';

/**
 * This app's centralized configuration, fetched server-side from config-service
 * and returned as ConfigurationPlain.
 *
 * Both backend addresses are rewritten to this app's own proxy paths before the
 * browser sees them — see `rewriteServiceDomains` for why a browser can never hold
 * the real address. The catalog goes through `/api/admin`, the configuration CRUD
 * through `/api/system`.
 *
 * auth-service is deliberately absent: this host reaches it through the auth
 * shell's hand-written per-endpoint handlers, which set and clear session
 * cookies and so cannot be a generic pipe.
 */
export const GET = createConfigRoute({
  service: 'back-office-app',
  proxies: {
    'marketplace-admin-service-domain': '/api/admin',
    'config-service-domain': '/api/system',
  },
});
