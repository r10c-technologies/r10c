import { Layer } from 'effect';

import { authFlowRoutes } from './auth-flow-routes.js';
import { sessionRoutes } from './session-routes.js';
import { userRoutes } from './user-routes.js';

/**
 * Every authn route: the credential flow, a signed-in user's own sessions and
 * devices, and the administration of other people's accounts. The host adds
 * its base routes and binds the identity provider's ports.
 */
export const authnRoutes = Layer.mergeAll(
  authFlowRoutes,
  sessionRoutes,
  userRoutes,
);
