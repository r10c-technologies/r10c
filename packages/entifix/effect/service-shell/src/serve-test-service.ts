import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Effect, Fiber, Layer } from 'effect';

import { makeServerLayer, type ServiceDefinition } from './make-service';
import { waitForHttp, type WaitForHttpOptions } from './wait-for-http';

/** A service booted in-process, and the handle that shuts it down. */
export interface RunningTestService {
  /** Origin the service is listening on, e.g. `http://127.0.0.1:53211`. */
  readonly baseUrl: string;
  /** Interrupts the launch fiber, releasing every Layer finalizer. */
  close(): Promise<void>;
}

export interface ServeTestServiceOptions extends WaitForHttpOptions {
  /** Fixed port. Omit to bind an ephemeral one, which is what tests want. */
  port?: number;
}

/**
 * Asks the OS for a free port by binding one and letting it go again.
 *
 * Exported because an ephemeral port is useful to any in-process boot, and
 * because a helper with its own name is easier to reason about than an inline
 * promise inside the launch sequence.
 */
export const freePort = (): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => {
        resolve(port);
      });
    });
  });

/**
 * Boots a service definition in-process on an ephemeral port and waits until it
 * answers `/api/health`.
 *
 * This is the seam the e2e `mock` profile runs on: the service's REAL `router`
 * and the REAL {@link makeServerLayer} wiring are used, with only the `appLayer`
 * swapped for one built from driver fakes. So the routes, the use-cases, the
 * repository adapter and the query translation all execute — what is absent is
 * the infrastructure, not the service.
 *
 * A boot failure (a Layer that dies) surfaces here rather than as a readiness
 * timeout: the launch fiber is raced against the health check, so a missing
 * dependency reports its own cause.
 */
export const serveTestService = async <E, R>(
  def: ServiceDefinition<E, R>,
  { port, ...waitOptions }: ServeTestServiceOptions = {},
): Promise<RunningTestService> => {
  const boundPort = port ?? (await freePort());
  const baseUrl = `http://127.0.0.1:${boundPort}`;

  const fiber = Effect.runFork(Layer.launch(makeServerLayer(def, boundPort)));

  // `Layer.launch` only ends when the service stops, so any failure of the
  // launch fiber during startup is the real reason the health check would
  // otherwise have timed out. `Fiber.join` re-raises the cause, so the defect
  // that killed the Layer — not a generic timeout — is what gets reported.
  const launchFailure = Effect.runPromise(Fiber.join(fiber)).catch(
    (error: unknown) => {
      throw new Error(`The service exited during startup: ${String(error)}`);
    },
  );
  // The same rejection fires again on a clean shutdown, when nobody is racing
  // it any more. Observed here so it is never an unhandled rejection.
  launchFailure.catch(() => undefined);

  await Promise.race([
    waitForHttp(`${baseUrl}/api/health`, waitOptions),
    launchFailure,
  ]);

  return {
    baseUrl,
    close: () =>
      Effect.runPromise(Fiber.interrupt(fiber)).then(() => undefined),
  };
};
