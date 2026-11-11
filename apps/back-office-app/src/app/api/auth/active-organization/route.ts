/**
 * `POST /api/auth/active-organization` — move this session to another of the
 * caller's organizations; sets the new session's cookies.
 */
export { switchOrganizationRoute as POST } from '@r10c/shells-next-auth/server';
