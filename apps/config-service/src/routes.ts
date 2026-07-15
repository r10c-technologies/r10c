import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { readConfigurationFromProcess } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

/**
 * config-service routes. `/api/health` is added by the service base.
 *
 * `GET /api/config/:service` returns only the requesting service's variables
 * (env names shaped `SERVICE__GROUP__KEY`), with the `SERVICE__` prefix
 * stripped, grouped into `ConfigurationPlain` by `readConfigurationFromProcess`.
 */
export const router = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/api/config/:service',
    Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      const service = params.service ?? '';
      const prefix = `${service}__`;

      const scoped: Record<string, string> = {};
      for (const [name, value] of Object.entries(process.env)) {
        if (value !== undefined && name.startsWith(prefix)) {
          scoped[name.slice(prefix.length)] = value;
        }
      }

      return yield* HttpServerResponse.json(readConfigurationFromProcess(scoped));
    })
  )
);
