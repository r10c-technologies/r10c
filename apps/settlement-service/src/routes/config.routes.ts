import { redactConfiguration } from '@entifix/service-shell';
import { LoadedConfigurationTag } from '@entifix/service-shell/runtime';
import { Effect } from 'effect';
import { HttpServerResponse } from 'effect/http';

/** `GET /api/config` — this service's loaded parameters (credentials redacted). */
export const configIntrospectionRoute = Effect.gen(function* () {
  const plain = yield* LoadedConfigurationTag;
  return yield* HttpServerResponse.json({
    service: '@r10c/settlement-service',
    store: 'mongo',
    configuration: redactConfiguration(plain),
  });
});
