import { SecurityView } from './security-view';

/**
 * `/account/security` — password, second factor and linked accounts.
 *
 * None of which r10c can change, which is the whole content of the page: it
 * explains where those live and links out. It replaced `/account/password`,
 * whose form posted a current and a new password to an endpoint that no longer
 * exists and to a store that no longer holds one.
 */
export default function SecurityPage() {
  return <SecurityView />;
}
