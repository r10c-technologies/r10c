import { navPrincipal } from '../../../lib/nav-principal';
import { workspaceScope } from '../../../lib/workspace-scope';
import { WorkspaceView } from './workspace-view';

/**
 * Server component, so the persisted workspace can be scoped to whoever is
 * signed in before any of it renders. The client cannot derive that itself: the
 * session cookies are httpOnly.
 */
export default async function WorkspacePage() {
  // The party role words a vendor's settlement tabs (#559): copy only, read
  // from unverified claims the way the sidebar reads it (ADR 0015).
  const { partyRole } = await navPrincipal();
  return (
    <WorkspaceView
      scope={await workspaceScope()}
      {...(partyRole === undefined ? {} : { partyRole })}
    />
  );
}
