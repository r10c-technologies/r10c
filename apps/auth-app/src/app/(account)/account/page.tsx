import { loadPrincipal } from '../../../lib/principal';
import { AccountView } from './account-view';

/**
 * `/account` — the signed-in user's own profile. Reachable by any session, not
 * just an administrative one.
 */
export default async function AccountPage() {
  const principal = await loadPrincipal();
  return <AccountView principal={principal} />;
}
