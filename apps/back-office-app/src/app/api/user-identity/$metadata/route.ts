/**
 * `GET /api/user-identity/$metadata` — what the signed-in caller may do with a
 * user record, proxied to auth-service with its caching headers intact.
 *
 * A literal segment, and it must be one: Next resolves a static segment ahead of
 * the sibling `[id]`, which is the same rule the service side relies on to keep
 * this route from being swallowed by its own by-id handler.
 */
export { userMetadataRoute as GET } from '@r10c/shells-next-auth/server';
