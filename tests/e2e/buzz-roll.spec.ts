import { expect, test } from '@playwright/test';
import { practiceTime } from './practice-clock';
import { chooseInstrument } from './instrument-picker';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('roll sticks remain pressed and Web Audio schedules four even contacts per quaver', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    const starts: number[] = [];
    Object.assign(window, { buzzStarts: starts });
    const original = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = original.call(this);
      const start = source.start.bind(source);
      source.start = (when = 0, offset = 0, duration?: number) => {
        starts.push(when);
        if (duration === undefined) start(when, offset); else start(when, offset, duration);
      };
      return source;
    };
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('./#colonel-bogey');
  await expect(page).toHaveTitle('SLSCC Band');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Colonel Bogey');
  await chooseInstrument(page, 'Side Drum');
  // The tied roll begins at score beat 6 (116 BPM), with a right-hand press
  // from ~3.103 to ~3.233 seconds. This is well after a single-stroke rebound.
  await practiceTime(page, 3.21);
  const angle = () => page.locator('.snare .right-stick').evaluate(el => Number((el as SVGElement).style.transform.match(/rotate\(([-\d.]+)deg\)/)![1]));
  expect(await angle()).toBeGreaterThan(46.8);
  expect(await angle()).toBeLessThanOrEqual(47.5);
  await expect(page.locator('.snare .drum-roll').filter({ visible: true })).toHaveCount(1);
  // The left hand takes over at ~3.233 and the next right roll starts at
  // ~3.362. The right stick makes a shallow recovery throughout that handover.
  const recovery: number[] = [];
  for (const position of [3.24, 3.26, 3.28, 3.30, 3.32, 3.34, 3.36, 3.38]) {
    await practiceTime(page, position);
    recovery.push(await angle());
    expect(await angle()).toBeGreaterThanOrEqual(39.5 - 1e-8);
  }
  expect(Math.min(...recovery)).toBeLessThan(41);
  await practiceTime(page, 3.29);
  await page.screenshot({ path: path.join(tmpdir(), 'buzz-roll-desktop.png') });
  await practiceTime(page, 8);
  await practiceTime(page, 3.21);
  expect(await angle()).toBeGreaterThan(46.8);
  await page.locator('.part-controls summary').click();
  await page.getByRole('button', { name: 'Solo Side Drum' }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { buzzStarts: number[] }).buzzStarts.length)).toBeGreaterThanOrEqual(4);
  const starts = await page.evaluate(() => (window as unknown as { buzzStarts: number[] }).buzzStarts.slice(0, 4));
  for (let i = 1; i < 4; i++) expect(starts[i] - starts[i - 1]).toBeCloseTo(60 / 116 / 8, 3);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await angle();
  await page.waitForTimeout(100);
  expect(await angle()).toBe(paused);
  await page.setViewportSize({ width: 390, height: 844 });
  await practiceTime(page, 3.21);
  expect(await angle()).toBeGreaterThan(46.8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.snare').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(tmpdir(), 'buzz-roll-phone.png') });
  expect(errors).toEqual([]);
});
