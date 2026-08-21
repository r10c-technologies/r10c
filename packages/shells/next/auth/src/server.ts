/**
 * The auth shell's **server** surface: route handlers, cookie helpers, the
 * principal loader, the redirect allowlist, the permission-annotated nav, and
 * the one page that is a server component.
 *
 * Everything reachable from here either reads `next/headers` or is called by
 * something that does. Keeping it out of the package's main entry is what stops
 * Next stamping a cookie reader as a client reference — the same reason
 * `shells-next-common` splits its own `/server`.
 */
export { AUTH_NAV } from './nav';
export type { Principal } from './principal-types';
export { AccountPage } from './server/account-page';
export { authorizationHeader, loadPrincipal } from './server/principal';
export { allowedRedirectOrigins, safeRedirect } from './server/redirect';
export {
  createUserRoute,
  deleteSessionRoute,
  logoutRoute,
  oidcCallbackRoute,
  oidcStartRoute,
  patchUserRoute,
  revokeOtherSessionsRoute,
  revokeUserSessionsRoute,
  sessionListRoute,
  userByIdRoute,
  userListRoute,
  userMetadataRoute,
  userSessionListRoute,
} from './server/routes';
export {
  AT_COOKIE,
  AUTH_SERVICE_URL,
  type AuthResult,
  clearSessionCookies,
  DEFAULT_REDIRECT,
  readSessionId,
  setSessionCookies,
  SID_COOKIE,
} from './server/session';
