import { SessionsView } from './sessions-view';

/**
 * `/account/sessions` — where the caller is signed in, and how to end it.
 * Data is fetched in the browser through this app's same-origin proxy, which
 * turns the httpOnly cookie into a bearer token server-side.
 */
export default function SessionsPage() {
  return <SessionsView />;
}
