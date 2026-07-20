import { killPort, waitForPortOpen } from '@nx/node/utils';

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const host = process.env.HOST ?? 'localhost';

/** Waits for the service under test to accept connections before any spec runs. */
export async function setup() {
  await waitForPortOpen(port, { host });
}

export async function teardown() {
  await killPort(port);
}
