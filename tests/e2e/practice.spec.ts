import { expect, test } from '@playwright/test';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('desktop practice controls change real playback and keep following independent of listening', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto('./');
  await expect(page).toHaveTitle('Marching Band Trainer');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('16 Bar Off Beat Routine (16 OBR)');
  await expect(page.locator('.score-choice')).toHaveCount(3);
  await expect(page.locator('.speed-heading output')).toHaveText('♩ = 116100%');
  await expect(page.locator('.transport-controls .part-controls')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mute Side Drum' })).toHaveText('');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  const seek = page.getByRole('slider', { name: 'Playback position' });
  await expect.poll(() => seek.inputValue()).toMatch(/^[1-9]/);
  await page.getByRole('button', { name: 'Mute Side Drum' }).click();
  await expect(page.getByRole('button', { name: 'Mute Side Drum' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Visualise Side Drum' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Solo Bass Drum' }).click();
  await expect(page.getByRole('button', { name: 'Solo Bass Drum' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Visualise Side Drum' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = Number(await seek.inputValue());
  await page.waitForTimeout(150);
  expect(Number(await seek.inputValue())).toBe(paused);
  await page.getByRole('button', { name: '50%', exact: true }).click();
  await expect(page.locator('#speed')).toHaveValue('50');
  await expect(page.locator('.speed-heading output')).toHaveText('♩ = 5850%');
  await seek.fill('8');
  await expect(seek).toHaveValue('8');
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(seek).toHaveValue('0');
  await page.getByRole('button', { name: /Colonel Bogey/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Colonel Bogey');
  await expect(page.getByText('Kenneth J. Alford', { exact: true })).toBeVisible();
  await expect(page.getByText('5 flats · D♭ major / B♭ minor')).toBeVisible();
  await expect(page.locator('.lyre-bar')).toHaveCount(25);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  expect(Number(await seek.getAttribute('max'))).toBeCloseTo(72 * 60 / 116, 2);
  await seek.fill('21');
  await expect(page.locator('.bar-readout strong')).toHaveText('Bar 3 / 14');
  await seek.fill('29');
  await expect(page.locator('.bar-readout strong')).toHaveText('Bar 11 / 14');
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await page.getByRole('button', { name: 'Visualise Side Drum' }).click();
  await expect(page.locator('.current-note strong')).toHaveText('R');
  await expect(page.locator('.practice-footer, .practice-tip, .catalogue-note, .register-note, .header-note')).toHaveCount(0);
  await page.getByRole('button', { name: 'Visualise Bell Lyre' }).click();
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.locator('.bar-letter').filter({ hasText: 'C♯6' })).toHaveCount(1);
  await expect(page.locator('.current-note strong')).not.toContainText('♭');
  await page.screenshot({ path: path.join(tmpdir(), 'marching-band-desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('phone and tablet catalogue, instrument and primary controls fit and respond', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await page.getByRole('searchbox', { name: 'Search scores' }).fill('colonel');
  await expect(page.locator('.score-choice')).toHaveCount(1);
  await page.getByRole('button', { name: /Colonel Bogey/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Colonel Bogey');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Visualise Side Drum' }).click();
  await expect(page.locator('.snare')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(tmpdir(), 'marching-band-phone.png'), fullPage: true });
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('Web Audio produces a signal, immediately mutes it, and keeps the visual transport moving', async ({ page }) => {
  await page.addInitScript(() => {
    const original = AudioContext.prototype.createGain;
    let attached = false;
    AudioContext.prototype.createGain = function () {
      const node = original.call(this);
      if (!attached) {
        attached = true;
        const analyser = this.createAnalyser();
        analyser.fftSize = 512;
        const silent = original.call(this);
        silent.gain.value = 0;
        node.connect(analyser); analyser.connect(silent); silent.connect(this.destination);
        Object.assign(window, { audioRms: () => {
          const buffer = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(buffer);
          return Math.sqrt(buffer.reduce((sum, sample) => sum + sample * sample, 0) / buffer.length);
        } });
      }
      return node;
    };
  });
  const rms = () => page.evaluate(() => (window as unknown as { audioRms?: () => number }).audioRms?.() || 0);
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('16 Bar Off Beat Routine (16 OBR)');
  await page.getByRole('button', { name: 'Solo Side Drum' }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(rms, { intervals: [30], timeout: 3000 }).toBeGreaterThan(0.0001);
  await page.getByRole('button', { name: 'Mute Side Drum' }).click();
  await expect.poll(rms, { intervals: [30] }).toBeLessThan(0.000001);
  const position = Number(await page.locator('#seek').inputValue());
  await expect.poll(async () => Number(await page.locator('#seek').inputValue())).toBeGreaterThan(position + 0.3);
  await expect(page.getByRole('button', { name: 'Visualise Side Drum' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(rms, { intervals: [30] }).toBeLessThan(0.000001);
});

test('one malformed archive does not prevent the other scores from loading', async ({ page }) => {
  await page.route('**/generated/scores/*16obr.mscz', route => route.fulfill({ body: 'invalid archive' }));
  await page.goto('./');
  await expect(page.getByRole('alert')).toContainText('Cannot open this MuseScore archive');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Colonel Bogey');
  await expect(page.getByRole('button', { name: /Holyrood/i })).toBeEnabled();
});
