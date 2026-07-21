import { type RequestHandler } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

/** What `setupServer` actually returns, so the type cannot drift from msw. */
export type EntifixMockServer = ReturnType<typeof setupServer>;

/**
 * Starts an MSW server for the current test file and wires its lifecycle.
 *
 * `onUnhandledRequest: 'error'` is the important part: a request nobody stubbed
 * fails the test instead of quietly escaping to the network. A test that passes
 * because it silently talked to nothing is worse than one that fails.
 *
 * ```ts
 * const server = setupEntifixServer(...entityRestHandlers(Product, { … }));
 * // inside a test, to override for one case:
 * server.use(respondWith500('http://service/api/product'));
 * ```
 */
export const setupEntifixServer = (
  ...handlers: RequestHandler[]
): EntifixMockServer => {
  const server = setupServer(...handlers);

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });
  afterEach(() => {
    server.resetHandlers();
  });
  afterAll(() => {
    server.close();
  });

  return server;
};
