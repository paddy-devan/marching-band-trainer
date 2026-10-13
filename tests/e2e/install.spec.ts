import { expect, test } from '@playwright/test';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('install instructions work on desktop and the mobile header fits', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await expect(page).toHaveTitle('SLSCC Band');
  await expect(page.getByRole('heading', { name: 'Scores', exact: true })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  const install = page.getByRole('button', { name: 'Install as App', exact: true });
  await expect(install).toBeVisible();
  await page.screenshot({ path: path.join(tmpdir(), 'slscc-install-desktop.png') });
  await install.click();
  const instructions = page.getByRole('dialog', { name: 'Install SLSCC Band' });
  await expect(instructions).toBeVisible();
  await expect(instructions).toContainText('Install app');
  await page.keyboard.press('Escape');
  await expect(instructions).not.toBeVisible();
  await expect(install).toBeFocused();
  await page.setViewportSize({ width: 320, height: 740 });
  await page.reload();
  await expect(page.getByRole('button', { name: /Colonel Bogey/ })).toBeVisible();
  await expect(install).toBeVisible();
  const brand = await page.locator('.brand').boundingBox();
  const button = await install.boundingBox();
  expect(brand!.x + brand!.width).toBeLessThan(button!.x);
  expect(button!.x + button!.width).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await install.blur();
  await page.screenshot({ path: path.join(tmpdir(), 'slscc-install-mobile.png') });
  await install.click();
  await expect(instructions).toBeVisible();
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(instructions).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('iPhone users receive Home Screen instructions', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL, viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    isMobile: true, hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto('./');
  await page.getByRole('button', { name: 'Install as App' }).click();
  const dialog = page.getByRole('dialog', { name: 'Install SLSCC Band' });
  await expect(dialog).toContainText('Add to Home Screen');
  await expect(dialog).toContainText('Open as Web App');
  await page.screenshot({ path: path.join(tmpdir(), 'slscc-install-iphone.png') });
  await page.getByRole('button', { name: 'Close installation instructions' }).click();
  await expect(dialog).not.toBeVisible();
  await context.close();
});

test('native prompts are used once and confirmed installs stay hidden after reload', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Install as App' })).toBeVisible();
  async function prompt(outcome: 'dismissed' | 'accepted') {
    await page.evaluate(result => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.assign(event, { prompt: async () => {
        document.documentElement.dataset.promptCalls = String(Number(document.documentElement.dataset.promptCalls || 0) + 1);
        return { outcome: result };
      } });
      window.dispatchEvent(event);
      document.documentElement.dataset.promptPrevented = String(event.defaultPrevented);
    }, outcome);
  }
  await prompt('dismissed');
  await expect(page.locator('html')).toHaveAttribute('data-prompt-prevented', 'true');
  await page.getByRole('button', { name: 'Install as App' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-prompt-calls', '1');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Install as App' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await prompt('accepted');
  await page.getByRole('button', { name: 'Install as App' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-prompt-calls', '2');
  await expect(page.getByRole('button', { name: 'Install as App' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Scores', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Install as App' })).toHaveCount(0);
  // Native availability overrides the remembered marker after uninstalling.
  await prompt('dismissed');
  await expect(page.getByRole('button', { name: 'Install as App' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.getByRole('button', { name: 'Install as App' })).toHaveCount(0);
});

test('standalone launches hide installation without requiring browser storage', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Scores', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Install as App' })).toHaveCount(0);
});

test('manifest and icons identify SLSCC Band', async ({ page }) => {
  await page.goto('./');
  const manifestUrl = await page.locator('link[rel="manifest"]').evaluate(link => (link as HTMLLinkElement).href);
  const response = await page.request.get(manifestUrl);
  const manifest = await response.json();
  expect(manifest.name).toBe('SLSCC Band');
  expect(manifest.display).toBe('standalone');
  expect(new URL(manifest.start_url, manifestUrl).pathname).toBe(new URL(page.url()).pathname);
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, manifestUrl).href;
    expect((await page.request.get(url)).ok()).toBe(true);
    const size = await page.evaluate(async src => {
      const image = new Image();
      image.src = src;
      await image.decode();
      return `${image.naturalWidth}x${image.naturalHeight}`;
    }, url);
    expect(size).toBe(icon.sizes);
  }
});

test('production loads scores offline', async ({ page, context }) => {
  // Vite development deliberately does not register an offline worker.
  test.skip(!process.env.E2E_URL, 'Offline verification requires a production preview');
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
    }
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Scores', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Colonel Bogey/ }).click();
  await expect(page.getByRole('heading', { name: 'Colonel Bogey', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await context.setOffline(false);
});
