import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { waitForHttp } from './wait-for-http.js';

/** Starts a bare HTTP server after `delayMs`, on `port`. */
const listenLater = (port: number, delayMs: number): Promise<Server> =>
  new Promise(resolve => {
    setTimeout(() => {
      const server = createServer((_req, res) => {
        res.end('ok');
      });
      server.listen(port, '127.0.0.1', () => {
        resolve(server);
      });
    }, delayMs);
  });

const closeServer = (server: Server) =>
  new Promise<void>(resolve => {
    server.close(() => {
      resolve();
    });
  });

/** A port nothing is listening on, taken and released. */
const closedPort = (): Promise<number> =>
  new Promise(resolve => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => {
        resolve(port);
      });
    });
  });

describe('waitForHttp', () => {
  it('returns once the url answers', async () => {
    const port = await closedPort();
    const pending = listenLater(port, 30);

    await waitForHttp(`http://127.0.0.1:${port}/`, { delayMs: 10 });

    await closeServer(await pending);
  });

  // The retry loop is the whole point; a single-shot check would fail against
  // any server that needs more than one tick to bind.
  it('gives up with the last transport error once the attempts run out', async () => {
    const port = await closedPort();

    await expect(
      waitForHttp(`http://127.0.0.1:${port}/`, { attempts: 2, delayMs: 1 }),
    ).rejects.toThrow(/Timed out waiting for .* after 2 attempts/);
  });
});
