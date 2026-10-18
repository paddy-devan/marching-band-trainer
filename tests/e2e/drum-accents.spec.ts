import { expect, test } from '@playwright/test';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('written drum accents prepare higher and sound stronger with unchanged beat timing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text()); });
  await page.goto('./#mcalpine');
  await expect(page).toHaveTitle('SLSCC Band');
  await expect(page).toHaveURL(/#mcalpine$/);
  await expect(page.getByRole('heading', { name: 'McAlpine', exact: true })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  const targets = await page.evaluate(async () => {
    const modulePath = '/src/score/loader.ts';
    const { loadCatalogue, loadScore } = await import(/* @vite-ignore */ modulePath);
    const timeline = await loadScore((await loadCatalogue()).find((entry: { id: string }) => entry.id === 'mcalpine'));
    const notes = timeline.score.notes.filter((note: { measure: number }) => note.measure === 25);
    const ids = new Set(notes.map((note: { id: string }) => note.id));
    return timeline.movements.filter((movement: { sourceId: string }) => ids.has(movement.sourceId))
      .map((movement: { time: number; accent?: boolean; velocity: number }) => ({ time: movement.time, accent: !!movement.accent, velocity: movement.velocity }));
  });
  const seek = page.getByRole('slider', { name: 'Playback position', exact: true });
  const angle = () => page.locator('.snare .right-stick').evaluate(el => Number((el as SVGElement).style.transform.match(/rotate\(([-\d.]+)deg\)/)![1]));
  for (const [name, viewport] of [['desktop', { width: 1366, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(viewport);
    await seek.fill((targets[0].time - 0.07).toFixed(2));
    expect(await angle()).toBeLessThan(12);
    await page.locator('.visual-panel').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(tmpdir(), `mcalpine-accent-preparation-${name}.png`) });
    await seek.fill((targets[2].time - 0.07).toFixed(2));
    expect(await angle()).toBeCloseTo(28); // Ordinary right-hand hit uses its normal lift.
    await seek.fill(targets[0].time.toFixed(2));
    expect(await angle()).toBeCloseTo(47.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.evaluate(async () => {
    const modulePath = '/src/audio/snare.ts';
    const { SnareSynth } = await import(/* @vite-ignore */ modulePath);
    const data = { strikes: [] as { when: number; velocity: number }[] };
    Object.assign(window, { accentAudio: data });
    const original = SnareSynth.prototype.strike;
    SnareSynth.prototype.strike = function (when: number, velocity: number, output: AudioNode) {
      data.strikes.push({ when, velocity });
      return original.call(this, when, velocity, output);
    };
  });
  await seek.fill((targets[0].time - 0.01).toFixed(2));
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { accentAudio: { strikes: unknown[] } }).accentAudio.strikes.length)).toBeGreaterThanOrEqual(7);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const strikes = await page.evaluate(() => (window as unknown as { accentAudio: { strikes: { when: number; velocity: number }[] } }).accentAudio.strikes.slice(0, 7));
  for (const [index, strike] of strikes.entries()) {
    expect(strike.when - strikes[0].when).toBeCloseTo(targets[index].time - targets[0].time, 5);
    expect(strike.velocity).toBeCloseTo(targets[index].velocity * (targets[index].accent ? 1.6 : 1));
  }
  expect(strikes[0].velocity / strikes[1].velocity).toBeGreaterThan(2.2);
  expect(errors).toEqual([]);
});
