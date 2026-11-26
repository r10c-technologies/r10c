import type { Page } from '@playwright/test';

/**
 * Opens a record's verb the way a seller does: its button when the action bar
 * shows it, or the overflow's item when the bar has run out of room
 * (entifix ADR 0026). Which one a verb lands in depends on how many the record
 * offers, so a journey that names the verb survives a new one being added.
 */
export const openVerb = async (page: Page, name: string) => {
  const more = page.getByRole('button', { name: 'Más acciones' });
  const button = page.getByRole('button', { name, exact: true });
  await more.or(button).first().waitFor();
  if (await button.isVisible()) {
    await button.click();
    return;
  }
  await more.click();
  await page.getByRole('menuitem', { name }).click();
};
