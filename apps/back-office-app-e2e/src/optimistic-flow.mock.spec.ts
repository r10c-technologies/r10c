import type { Page } from '@playwright/test';
import { http, HttpResponse } from 'msw';

import { expect, FLOW_STATUS_URL, PRODUCT_URL, test } from './support/fixtures';
import {
  flowAccepted as acceptedAs,
  scriptStream as scriptFlow,
} from './support/flow-stream';

/**
 * The optimistic contract in the back office (ADR 0073): the server picks the
 * mode, a `202` keeps the form open and waiting, the push stream settles it,
 * and a reload catches up from flow-status.
 *
 * Mock-only by nature: the `202` and the stream's frames are chosen here. What runs for real is
 * everything in the browser: the writer, the pending-flow store over
 * IndexedDB, the push channel and the toast region.
 */

const FLOW_ID = 'flow-spec-1';

const flowAccepted = acceptedAs(FLOW_ID);

const FAILURE = { code: 'declined', category: 'declined' } as const;
const DECLINED_COPY = /La solicitud fue rechazada\./;

const createSpecification = async (page: Page, name: string) => {
  await page.goto('/catalog/product/new');
  await page.getByLabel('Nombre').fill(name);
  await page.getByRole('button', { name: 'Guardar' }).click();
};

/** The toasts, inside their region — Next's route announcer is an alert too. */
const toasts = (page: Page) =>
  page.getByRole('region', { name: 'Notificaciones' }).getByRole('alert');

const LIST = /\/catalog\/product$/;
const NEW_FORM = /\/catalog\/product\/new$/;

const waiting = (page: Page) =>
  page.getByRole('button', { name: 'Esperando al servidor…' });

test('a save that commits settles and returns to the list', async ({
  page,
}) => {
  await createSpecification(page, 'Widget settled');

  await expect(page).toHaveURL(LIST);
  await expect(waiting(page)).toHaveCount(0);
});

test('a write handed to a flow waits on its form, then confirms by push', async ({
  page,
  network,
}) => {
  network.use(http.post(PRODUCT_URL, flowAccepted));
  const script = scriptFlow(network, FLOW_ID);

  await createSpecification(page, 'Widget pending');

  await expect(waiting(page)).toBeVisible();
  await expect(page).toHaveURL(NEW_FORM);

  script.outcome = 'flow.completed';

  await expect(page).toHaveURL(LIST);
  await expect(toasts(page)).toHaveCount(0);
});

test('a failed flow shows one translated toast and keeps what was typed', async ({
  page,
  network,
}) => {
  network.use(http.post(PRODUCT_URL, flowAccepted));
  const script = scriptFlow(network, FLOW_ID);

  await createSpecification(page, 'Widget refused');
  await expect(waiting(page)).toBeVisible();

  script.outcome = 'flow.failed';

  const toast = toasts(page);
  await expect(toast).toHaveText(DECLINED_COPY);
  // The outcome arrived twice; the toast is one.
  await expect(toast).toHaveCount(1);
  await expect(page.getByLabel('Nombre')).toHaveValue('Widget refused');
  await expect(page.getByText(/^declined$/)).toHaveCount(0);
});

test('a reload while pending restores the flow and settles it from flow-status', async ({
  page,
  network,
}) => {
  network.use(http.post(PRODUCT_URL, flowAccepted));
  // No reconnect before the reload: the tab that wrote must not be the one that
  // catches up, or the reloaded tab would find nothing pending.
  scriptFlow(network, FLOW_ID, { retryMs: 60_000 });

  // The writing tab reads flow-status once, when the stream reopens with the
  // flow's topic, and is answered `404` — still pending. Only after that read
  // is the outcome made available, or the writing tab would settle it.
  const stillPending = page.waitForResponse(
    response =>
      response.url().endsWith(`/api/realtime/flow/${FLOW_ID}`) &&
      response.status() === 404,
  );
  await createSpecification(page, 'Widget reloaded');
  await expect(waiting(page)).toBeVisible();
  await stillPending;

  // The outcome never arrives as a push: the tab was gone when it was sent.
  // What the reloaded tab has is its pending-flow store and flow-status.
  network.use(
    http.get(FLOW_STATUS_URL, () =>
      HttpResponse.json({
        meta: { type: 'flowStatus', entity: 'flow' },
        data: { flowId: FLOW_ID, state: 'failed', failure: FAILURE },
      }),
    ),
  );
  const caughtUp = page.waitForRequest(request =>
    request.url().endsWith(`/api/realtime/flow/${FLOW_ID}`),
  );
  await page.reload();
  await caughtUp;

  await expect(toasts(page)).toHaveText(DECLINED_COPY);
});
