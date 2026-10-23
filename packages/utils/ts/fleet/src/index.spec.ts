import { afterEach, describe, expect, it } from 'vitest';

import {
  configApiUrl,
  configSourceFor,
  DEV_SERVICE_TOKEN,
  fleetToken,
  SERVICE_TOKEN_HEADER,
  serviceToken,
} from './index.js';

afterEach(() => {
  delete process.env['CONFIG_SERVICE_TOKEN'];
  delete process.env['CONFIG_API_URL'];
});

describe('the fleet token', () => {
  it('falls back to the documented dev token', () => {
    expect(serviceToken()).toBe(DEV_SERVICE_TOKEN);
  });

  it('reads the environment on each call, not at module load', () => {
    process.env['CONFIG_SERVICE_TOKEN'] = 'from-env';

    expect(serviceToken()).toBe('from-env');
    expect(fleetToken.token()).toBe('from-env');
    expect(fleetToken.header).toBe(SERVICE_TOKEN_HEADER);
  });
});

describe('the configuration source', () => {
  it('defaults to the local lab and carries the token', () => {
    expect(configSourceFor('order-service')).toEqual({
      url: 'http://localhost:3190/api/config/order-service',
      headers: { 'x-service-token': DEV_SERVICE_TOKEN },
    });
  });

  // The base URL comes from an env var, so a trailing slash is entirely likely
  // and must not produce a `//api/config` path.
  it('tolerates a trailing slash on CONFIG_API_URL', () => {
    process.env['CONFIG_API_URL'] = 'http://config:3190///';

    expect(configApiUrl()).toBe('http://config:3190');
    expect(configSourceFor('auth-app').url).toBe(
      'http://config:3190/api/config/auth-app',
    );
  });
});
