import { createConfigRoute } from '@r10c/shells-next-common/server';

/**
 * This app's centralized configuration, fetched server-side from config-service
 * and returned as ConfigurationPlain.
 *
 * Every backend address is rewritten to this app's own proxy path before the
 * browser sees it — see `rewriteServiceDomains` for why a browser can never hold
 * the real address. The vendor-authored catalog goes through `/api/admin`, the
 * platform vocabulary it is classified in through `/api/marketplace`, the
 * configuration CRUD through `/api/system`.
 *
 * Two catalog backends and not one since ADR 0022: `ProductSpecification` is
 * tenant-plane and marketplace-admin-service owns it, while `ProductBrand` and
 * `ProductCategory` are platform-plane and marketplace-service owns them.
 *
 * auth-service is deliberately absent: this host reaches it through the auth
 * shell's hand-written per-endpoint handlers, which set and clear session
 * cookies and so cannot be a generic pipe.
 */
export const GET = createConfigRoute({
  service: 'back-office-app',
  proxies: {
    'marketplace-admin-service-domain': '/api/admin',
    'marketplace-service-domain': '/api/marketplace',
    'config-service-domain': '/api/system',
  },
});
