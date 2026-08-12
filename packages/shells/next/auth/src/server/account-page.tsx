import { AccountView } from '../client/account-view';
import { loadPrincipal } from './principal';

/**
 * `/account` — the signed-in user's own profile. Reachable by any session, not
 * just an administrative one.
 */
export async function AccountPage() {
  const principal = await loadPrincipal();
  return <AccountView principal={principal} />;
}
