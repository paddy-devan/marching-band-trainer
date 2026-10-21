import type { Page } from '@playwright/test';

export async function chooseInstrument(page: Page, name: string) {
  await page.getByRole('combobox', { name: 'Visualised instrument' }).click();
  await page.getByRole('option', { name, exact: true }).click();
}
