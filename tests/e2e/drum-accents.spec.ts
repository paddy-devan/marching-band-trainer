import { expect, test } from '@playwright/test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Movement } from '../../src/score/model';

test('Balaklava dynamics change rendered stick heights, with relative accents and low roll handovers', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text()); });
  await page.goto('./#balaklava');
  await expect(page).toHaveTitle('SLSCC Band');
  await expect(page).toHaveURL(/#balaklava$/);
  await expect(page.getByRole('heading', { name: 'Balaklava', exact: true })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Visualisation' }).selectOption({ label: 'Side Drum' });
  const targets = await page.evaluate(async () => {
    const modulePath = '/src/score/loader.ts';
    const { loadCatalogue, loadScore } = await import(/* @vite-ignore */ modulePath);
    const timeline = await loadScore((await loadCatalogue()).find((entry: { id: string }) => entry.id === 'balaklava'));
    const part = timeline.score.parts.find((part: { name: string }) => part.name === 'Side Drum');
    const notes: Movement[] = timeline.movements.filter((movement: Movement) => movement.partId === part.id);
    const ordinary = [49, 64, 96].map(midi => notes.find((note, i) => {
      const previous = notes.slice(0, i).filter(other => other.hand === note.hand).at(-1);
      return !note.roll && !note.accent && Math.abs(note.dynamicVelocity! - midi / 127) < 1e-6 &&
        (!previous || (!previous.roll && note.time - previous.time > 0.3));
    })!);
    const accented = notes.find(note => note.accent && note.dynamicVelocity === 96 / 127)!;
    const rolls = [49, 96].map(midi => notes.find((note, i) => {
      const next = notes[i + 1];
      return note.roll && note.dynamicVelocity === midi / 127 && next?.roll &&
        next.time <= note.time + note.seconds + 1e-6;
    })!);
    const transitions = notes.flatMap((note, i) => {
      const previous = notes.slice(0, i).filter(other => other.hand === note.hand).at(-1);
      if (!previous || previous.roll || note.roll || note.flam || previous.flam) return [];
      const gap = note.time - previous.time;
      return gap > 0.4 && gap <= 1.25 && (note.accent !== previous.accent || note.dynamicVelocity !== previous.dynamicVelocity)
        ? [{ previous, next: note }] : [];
    });
    return { ordinary, accented, rolls, transitions };
  });
  expect(targets.ordinary.every(Boolean)).toBe(true);
  expect(targets.rolls.every(Boolean)).toBe(true);
  expect(targets.transitions.length).toBeGreaterThan(1);
  const seek = page.getByRole('slider', { name: 'Playback position', exact: true });
  const seekTo = (seconds: number) => seek.fill(String(Number(seconds.toFixed(2))));
  const angle = (note: Movement) => page.locator(`.snare .${note.hand === 'R' ? 'right' : 'left'}-stick`)
    .evaluate(el => Number((el as SVGElement).style.transform.match(/rotate\(([-\d.]+)deg\)/)![1]));
  for (const [name, viewport] of [['desktop', { width: 1366, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(viewport);
    for (const [index, { previous, next }] of targets.transitions.entries()) {
      await seekTo(previous.time + 0.12);
      const prepared = await angle(next);
      if (!index) await page.locator('.snare').screenshot({ path: path.join(tmpdir(), `balaklava-early-preparation-${name}.png`) });
      await seekTo(next.time - 0.07);
      expect(await angle(next)).toBeCloseTo(prepared, 0);
      await seekTo(previous.time + 0.12);
      expect(await angle(next)).toBeCloseTo(prepared);
    }
    const heights: number[] = [];
    for (const note of [...targets.ordinary, targets.accented]) {
      await seekTo(note.time - 0.07);
      heights.push(await angle(note));
      if (note === targets.ordinary[0] || note === targets.accented) {
        await page.locator('.snare').screenshot({ path: path.join(tmpdir(), `balaklava-${note.accent ? 'f-accent' : 'p'}-${name}.png`) });
      }
      await seekTo(note.time);
      expect(await angle(note)).toBeCloseTo(47.5, 0);
    }
    expect(heights[0]).toBeGreaterThan(heights[1]);
    expect(heights[1]).toBeGreaterThan(heights[2]);
    expect(heights[2]).toBeGreaterThan(heights[3]);
    const recoveries: number[] = [];
    for (const roll of targets.rolls) {
      await seekTo(roll.time + roll.seconds * 1.5);
      recoveries.push(await angle(roll));
    }
    expect(recoveries[0]).toBeGreaterThan(recoveries[1]);
    expect(recoveries[1]).toBeGreaterThan(34);
    await seekTo(targets.accented.time - 0.07);
    await page.locator('.visual-panel').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(tmpdir(), `balaklava-dynamics-${name}.png`) });
  }
  expect(errors).toEqual([]);
});

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
    // This accent releases a roll: recover smoothly from the final press,
    // reaching full preparation before its shortened downstroke begins.
    expect(await angle()).toBeLessThan(28);
    await seek.fill(String(Number((targets[0].time - 0.05).toFixed(2))));
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
