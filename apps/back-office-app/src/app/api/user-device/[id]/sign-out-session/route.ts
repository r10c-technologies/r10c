/**
 * `POST /api/user-device/:id/sign-out-session` — end one of the caller's own
 * sessions; the id is the session's. Clears this origin's cookies when the
 * session ended is the one in use.
 */
export { signOutSessionRoute as POST } from '@r10c/shells-next-auth/server';
