/**
 * `GET /api/user-device/$metadata` — the device verbs the signed-in caller may
 * run, proxied to auth-service with its caching headers intact. The sessions
 * screen reads `sign-out-session` from it.
 */
export { userDeviceMetadataRoute as GET } from '@r10c/shells-next-auth/server';
