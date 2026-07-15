import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { resolveSessionUCFactory, SessionIdTag } from '@r10c/business-ts-authn';
import { Effect } from 'effect';

import { describeIdentityModel } from './identity/identity-showcase';

/**
 * auth-service routes. `/api/health` is added by the service base.
 *
 * The session route's requirement (`IdentityProviderTag`, yielded by the UC)
 * is satisfied by `AppLayer` in the composition root — tracked in the type, so
 * a missing provider is a compile error, not a runtime surprise.
 */
export const router = HttpRouter.empty.pipe(
  // Resolve an opaque session id → principal via the framework-free use-case.
  HttpRouter.get(
    '/api/auth/session/:sessionId',
    Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      const sessionId = params.sessionId ?? '';
      const principal = yield* resolveSessionUCFactory().pipe(
        Effect.provideService(SessionIdTag, sessionId)
      );
      return yield* HttpServerResponse.json(principal);
    }).pipe(
      // Authn failures collapse to 401 at the perimeter; cause is not leaked.
      Effect.catchAll(() =>
        HttpServerResponse.json(
          { error: 'session could not be resolved' },
          { status: 401 }
        )
      )
    )
  ),
  // Native-entity proof: construct entity classes + read stage-3 metadata.
  HttpRouter.get(
    '/api/identity/demo',
    Effect.sync(describeIdentityModel).pipe(
      Effect.flatMap((model) => HttpServerResponse.json(model))
    )
  )
);
