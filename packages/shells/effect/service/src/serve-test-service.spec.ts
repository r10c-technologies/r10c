import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { Context, Effect, Layer } from 'effect';

import { freePort, serveTestService } from './serve-test-service.js';

class GreetingTag extends Context.Tag('GreetingTag')<GreetingTag, string>() {}

const router = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/api/greeting',
    Effect.gen(function* () {
      const greeting = yield* GreetingTag;
      return yield* HttpServerResponse.json({ greeting });
    }),
  ),
);

const definition = {
  name: '@r10c/spec-service',
  port: 0,
  router,
  appLayer: Layer.succeed(GreetingTag, 'hello'),
};

describe('serveTestService', () => {
  it('serves the real router and health route on an ephemeral port', async () => {
    const service = await serveTestService(definition);

    const health = await fetch(`${service.baseUrl}/api/health`);
    expect(await health.json()).toEqual({
      status: 'ok',
      service: '@r10c/spec-service',
    });

    // The domain route resolves its dependency from `appLayer`, proving the
    // composition root is wired and not just the base skeleton.
    const greeting = await fetch(`${service.baseUrl}/api/greeting`);
    expect(await greeting.json()).toEqual({ greeting: 'hello' });

    await service.close();
  });

  it('binds the port it was given', async () => {
    const port = await freePort();

    const service = await serveTestService(definition, { port });

    expect(service.baseUrl).toBe(`http://127.0.0.1:${port}`);
    await service.close();
  });

  // A dependency that cannot be built must report its own cause. Reported as a
  // readiness timeout it would look like a slow boot, and the actual reason
  // would never reach the person reading the failure.
  it('reports a layer that dies during startup', async () => {
    await expect(
      serveTestService(
        {
          ...definition,
          appLayer: Layer.die(new Error('mongo is unreachable')),
        },
        { attempts: 100, delayMs: 20 },
      ),
    ).rejects.toThrow(/exited during startup[\s\S]*mongo is unreachable/);
  });

  it('stops answering once closed', async () => {
    const service = await serveTestService(definition);
    await service.close();

    await expect(fetch(`${service.baseUrl}/api/health`)).rejects.toThrow();
  });
});
