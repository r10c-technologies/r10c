/**
 * The auth shell's **client** surface: the pages a host mounts as route files.
 *
 * `AccountPage` is deliberately absent — it is a server component that awaits
 * `loadPrincipal`, so it ships from `./server` with everything else that reads
 * `next/headers`.
 */
export { SecurityPage } from './client/account-security-page';
export { SecurityView } from './client/account-security-view';
export { SessionsPage } from './client/account-sessions-page';
export { type SessionRow, SessionsView } from './client/account-sessions-view';
export { AccountView } from './client/account-view';
export { useAsyncResource } from './client/use-async-resource';
export { useUsers } from './client/use-users';
export { UsersPage } from './client/user-list-page';
export { NewUserPage } from './client/user-new-page';
export { UserSessionsPanel } from './client/user-sessions-panel';
export { UserDetailPage } from './client/user-single-page';
export type { Principal } from './principal-types';
