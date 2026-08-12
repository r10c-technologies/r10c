import { requireLiveUrl } from '@r10c/entifix-ts-testing-e2e';

import { expect, test } from './support/fixtures';

/**
 * The half of the protocol the browser cannot reach.
 *
 * The metadata allowlist is enforced on the server, so the UI *cannot* compose
 * a query that violates it — which is the point. Driving the API directly is the
 * only way to prove the guard is there, and it needs the real service, so this
 * is live-only.
 */

const SERVICE_URL = requireLiveUrl('MARKETPLACE_ADMIN_SERVICE_URL');

test.describe('the server-side query allowlist', () => {
  test('rejects a query naming a member that is not filterable', async ({
    request,
  }) => {
    const response = await request.get(
      `${SERVICE_URL}/api/product-brand?rsql=${encodeURIComponent('nope==1')}`,
    );

    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBe('invalid query');
  });

  test('rejects a sort naming an unknown member', async ({ request }) => {
    const response = await request.get(
      `${SERVICE_URL}/api/product-brand?sort=nope`,
    );

    expect(response.status()).toBe(400);
  });
});
