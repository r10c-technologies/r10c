import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { defineServiceE2e, type ServiceE2eContext } from './define-service-e2e';

/** A stand-in for the service under test: answers `/api/health` and nothing else. */
const startStubService = (): Promise<{ server: Server; baseUrl: string }> =>
  new Promise(resolve => {
    const server = createServer((request, response) => {
      const ok = request.url === '/api/health';
      response.writeHead(ok ? 200 : 404, {
        'content-type': 'application/json',
      });
      response.end(JSON.stringify(ok ? { status: 'ok' } : { error: 'nope' }));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });

const stopStubService = (server: Server) =>
  new Promise<void>(resolve => {
    server.close(() => {
      resolve();
    });
  });

/** Kept across suites so the teardown of one can be asserted by the next. */
let mockContext: ServiceE2eContext;

describe('defineServiceE2e in the mock profile', () => {
  process.env['E2E_PROFILE'] = 'mock';

  let closed = false;

  mockContext = defineServiceE2e({
    liveUrlEnvVar: 'R10C_SPEC_SERVICE_URL',
    startMock: async () => {
      const { server, baseUrl } = await startStubService();
      return {
        baseUrl,
        close: async () => {
          closed = true;
          await stopStubService(server);
        },
      };
    },
  });

  it('boots the service in-process and points the client at it', async () => {
    expect(mockContext.profile).toBe('mock');
    expect(mockContext.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const response = await mockContext.client.get('/api/health');
    expect(response.status).toBe(200);
    expect(response.data).toEqual({ status: 'ok' });
  });

  // Service e2e suites assert on 4xx (the query allowlist, a missing record),
  // so a client that threw on them would make half the surface untestable.
  it('gives a client that treats 4xx as a result, not a throw', async () => {
    const response = await mockContext.client.get('/api/nothing');

    expect(response.status).toBe(404);
    expect(closed).toBe(false);
  });
});

describe('defineServiceE2e in the live profile', () => {
  process.env['E2E_PROFILE'] = 'live';

  let server: Server;

  // Registered before `defineServiceE2e`'s own hook, so the target exists — and
  // is advertised — by the time the suite resolves it.
  beforeAll(async () => {
    const stub = await startStubService();
    server = stub.server;
    process.env['R10C_SPEC_SERVICE_URL'] = `${stub.baseUrl}/`;
  });

  const context = defineServiceE2e({
    liveUrlEnvVar: 'R10C_SPEC_SERVICE_URL',
    startMock: () => Promise.reject(new Error('startMock must not run live')),
  });

  afterAll(async () => {
    await stopStubService(server);
    delete process.env['R10C_SPEC_SERVICE_URL'];
    process.env['E2E_PROFILE'] = 'mock';
  });

  it('talks to the already-running service', async () => {
    expect(context.profile).toBe('live');
    const response = await context.client.get('/api/health');

    expect(response.status).toBe(200);
  });
});

describe('the profile-agnostic handle', () => {
  // This suite runs after the mock one has torn down, so the same context is
  // now unstarted — which is exactly the state a module-scope read would see.
  it('fails loudly when read outside a running suite', () => {
    expect(() => mockContext.baseUrl).toThrow(/not running yet/);
    expect(() => mockContext.client).toThrow(/not running yet/);
  });
});
