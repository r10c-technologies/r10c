import { workspaceScope } from '../../../lib/workspace-scope';
import { WorkspaceView } from './workspace-view';

/**
 * Server component, so the persisted workspace can be scoped to whoever is
 * signed in before any of it renders. The client cannot derive that itself: the
 * session cookies are httpOnly.
 */
export default async function WorkspacePage() {
  return <WorkspaceView scope={await workspaceScope()} />;
}
