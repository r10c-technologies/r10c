import { HttpServerResponse } from '@effect/platform';
import {
  LoadedConfigurationTag,
  redactConfiguration,
} from '@r10c/shells-effect-service';
import { Effect } from 'effect';

/** `GET /api/config` — this service's loaded parameters (credentials redacted). */
export const configIntrospectionRoute = Effect.gen(function* () {
  const plain = yield* LoadedConfigurationTag;
  return yield* HttpServerResponse.json({
    service: '@r10c/marketplace-service',
    store: 'mongo',
    configuration: redactConfiguration(plain),
  });
});
