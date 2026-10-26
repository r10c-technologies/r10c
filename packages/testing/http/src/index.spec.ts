import { Context, Effect, Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import { describe, expect, it } from 'vitest';

import { serveRoutes } from './index.js';

class Greeting extends Context.Service<Greeting, string>()('Greeting') {}

describe('serveRoutes', () => {
  it('serves a route set over the services a spec provides', async () => {
    const routes = HttpRouter.addAll([
      HttpRouter.route(
        'GET',
        '/api/hello',
        Effect.gen(function* () {
          return yield* HttpServerResponse.json({ greeting: yield* Greeting });
        }),
      ),
    ]);
    const served = serveRoutes(routes, Layer.succeed(Greeting, 'hola'));
    try {
      const response = await served.call('/api/hello');

      expect(await response.json()).toEqual({ greeting: 'hola' });
    } finally {
      await served.dispose();
    }
  });
});
