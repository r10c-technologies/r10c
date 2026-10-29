import type { NetworkFixture } from '@entifix/testing-e2e/playwright';
import type { Page } from '@playwright/test';
import { http, HttpResponse } from 'msw';

import { expect, PRODUCT_URL, test } from './support/fixtures';

/**
 * The guided alta of a product — the first `wizard:` screen in the fleet
 * ([ADR 0045](../../../docs/adr/0045-the-wizard-a-step-graph-and-a-submit-that-hands-off.md)).
 *
 * Four things only a browser can prove, and each is a decision rather than a
 * rendering detail:
 *
 * - the stepper **re-shapes** when the branch point is answered, because the
 *   path is projected from the answers rather than read off the step list;
 * - a step's own submit **gates** the advance, so "Continuar" is that step's
 *   validation and not a page turn;
 * - the draft lives **above** the forms, so Back and a mid-flow refresh both
 *   return what was typed even though the step component unmounted;
 * - the ending is a **hand-off**: one create carrying the merged draft, and
 *   the operator returned to the list it lands in.
 *
 * ⚠️ Mock-only, and for `catalog-classification`'s reason: observing the request
 * body means choosing the response.
 */

const WIZARD = '/wizards/product-setup';
const PRODUCT_LIST = '/catalog/product';

/** Captures the record the wizard puts on the wire, and answers as the service does. */
const captureCreate = (
  network: NetworkFixture,
): { record?: Record<string, unknown> } => {
  const captured: { record?: Record<string, unknown> } = {};

  network.use(
    http.post(PRODUCT_URL, async ({ request }) => {
      const envelope = (await request.json()) as {
        meta: { entity: string };
        data: Record<string, unknown>;
      };
      captured.record = envelope.data;

      return HttpResponse.json({
        meta: { type: 'entity', entity: envelope.meta.entity },
        data: { ...envelope.data, id: 'spec-created', code: 'product-901' },
      });
    }),
  );

  return captured;
};

const next = (page: Page) => page.getByTestId('wizard-next').click();
const back = (page: Page) => page.getByTestId('wizard-previous').click();

/** The stepper's own list, which is `<ol>` and deliberately not a tablist. */
const steps = (page: Page) => page.getByRole('list', { name: 'Pasos' });

/**
 * The identity step asks for a name and a description, and **not for a code**:
 * the create draws that from the organization's counter, so a field for it would
 * be asking the operator to type a value the service overwrites.
 */
const fillIdentity = async (page: Page, name: string) => {
  await page.getByLabel(/nombre/i).fill(name);
};

test('walks the blank path and hands one create off', async ({
  page,
  network,
}) => {
  const captured = captureCreate(network);
  await page.goto(WIZARD);

  // Four steps, and none of them the table only the other branch reaches.
  await expect(steps(page).getByRole('listitem')).toHaveCount(4);
  await expect(steps(page)).not.toContainText('Producto base');

  await page.getByRole('button', { name: /Desde cero/ }).click();
  await next(page);

  // The step's own submit gates the advance: `nombre` is required and this is
  // the step that owns it.
  await next(page);
  await expect(
    page.getByRole('heading', { name: 'Identificación' }),
  ).toBeVisible();
  await expect(page.getByLabel(/código/i)).toHaveCount(0);

  await fillIdentity(page, 'Café de altura');
  await next(page);

  // The classification step is *not* blocked by `nombre`, which belongs to the
  // step before it — without a per-step scope, no step but the last could pass.
  await expect(
    page.getByRole('heading', { name: 'Clasificación' }),
  ).toBeVisible();
  await next(page);

  // The summary repeats what was answered, before anything is written.
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
  await expect(page.getByText('Café de altura')).toBeVisible();

  await page.getByTestId('wizard-next').click();
  await page.waitForURL(url => url.pathname.endsWith(PRODUCT_LIST));

  // One create, carrying the two steps' drafts merged — and no `code`, which
  // the service draws.
  expect(captured.record).toMatchObject({ name: 'Café de altura' });
  expect(captured.record).not.toHaveProperty('code');

  // The write answered with the record, so nothing is left pending.
  await expect(page.getByTestId('pending-notice')).toHaveCount(0);
});

test('re-shapes the stepper and seeds the forms from the product it duplicates', async ({
  page,
}) => {
  await page.goto(WIZARD);

  await page.getByRole('button', { name: /Duplicar uno existente/ }).click();

  // A fifth step appears: the path is projected from the answer, not declared.
  await expect(steps(page).getByRole('listitem')).toHaveCount(5);
  await expect(steps(page)).toContainText('Producto base');

  await next(page);
  await page
    .getByRole('row', { name: /Gadget/ })
    .getByRole('button', { name: 'Seleccionar' })
    .click();
  await next(page);

  // Seeded through `cloneEntityDraft`, which drops the id and every member
  // declared `resetOnClone`. The code is neither shown nor carried: it
  // identifies the original, and the service assigns the copy its own.
  await expect(page.getByLabel(/nombre/i)).toHaveValue('Gadget');
  await expect(page.getByLabel(/código/i)).toHaveCount(0);
});

test('keeps an earlier step’s answers when the operator goes back', async ({
  page,
}) => {
  await page.goto(WIZARD);

  await page.getByRole('button', { name: /Desde cero/ }).click();
  await next(page);
  await fillIdentity(page, 'Té de jazmín');
  await next(page);
  await back(page);

  // The step component unmounted and came back. Nothing was lost, because the
  // draft never lived inside it.
  await expect(page.getByLabel(/nombre/i)).toHaveValue('Té de jazmín');
});

test('moves a step on browser-Back rather than leaving the wizard', async ({
  page,
}) => {
  // Arrived with no step in the address, which is how the nav item links here.
  // The first step is never pushed, so Back from the second lands on the bare
  // address — and a bare address *means* the beginning, which is what the
  // follower reads it as rather than rewriting it.
  await page.goto(WIZARD);

  await page.getByRole('button', { name: /Desde cero/ }).click();
  await next(page);
  await expect(page).toHaveURL(/step=identity/);

  await page.goBack();

  // Asserted on the address first: if Back landed somewhere else entirely, the
  // heading assertion below would only say "not found".
  await expect(page).toHaveURL(/step=start/);
  await expect(page.getByRole('heading', { name: 'Origen' })).toBeVisible();
});

test('resumes a half-finished flow after a refresh, and recaps it', async ({
  page,
}) => {
  await page.goto(WIZARD);

  await page.getByRole('button', { name: /Desde cero/ }).click();
  await next(page);
  await fillIdentity(page, 'Cacao');
  await next(page);
  await expect(
    page.getByRole('heading', { name: 'Clasificación' }),
  ).toBeVisible();

  await page.reload();

  // Position and values both come back — the position from the persisted
  // wizard, not from the address.
  await expect(
    page.getByRole('heading', { name: 'Clasificación' }),
  ).toBeVisible();
  await expect(page.getByTestId('wizard-recap')).toContainText('Cacao');
});

test('opens as a workspace tab, captioned by the wizard and not the step', async ({
  page,
}) => {
  await page.goto('/workspace?tab=wizard:product-setup');

  await expect(page.getByRole('tab', { name: /Nuevo producto/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Origen' })).toBeVisible();
});
