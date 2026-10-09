import { expect, test, type Page } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function observeChallengeAudio(page: Page) {
  // Observe actual audio scheduling; inject an event timestamp at the scheduled
  // attack so this integration check doesn't depend on CI/automation latency.
  await page.addInitScript(() => {
    const original = AudioContext.prototype.createOscillator;
    const data = { context: undefined as AudioContext | undefined, notes: [] as { frequency: number; when: number; scheduled: boolean }[], counts: [] as number[] };
    Object.assign(window, { challengeAudio: data });
    AudioContext.prototype.createOscillator = function () {
      data.context = this;
      const oscillator = original.call(this);
      let frequency = 0;
      const setFrequency = oscillator.frequency.setValueAtTime.bind(oscillator.frequency);
      oscillator.frequency.setValueAtTime = (value, when) => { frequency = value; return setFrequency(value, when); };
      const start = oscillator.start.bind(oscillator);
      oscillator.start = (when = 0) => { data.notes.push({ frequency, when, scheduled: when > this.currentTime + 0.001 }); start(when); };
      return oscillator;
    };
    new MutationObserver(() => {
      const stars = document.querySelector('.game-stars');
      if (!stars) return;
      const count = stars.querySelectorAll('.filled').length;
      if (data.counts.at(-1) !== count) data.counts.push(count);
    }).observe(document, { subtree: true, attributes: true, childList: true });
  });
}

async function tapScheduledNote(page: Page, index: number) {
  await expect.poll(() => page.evaluate(() => {
    const data = (window as unknown as { challengeAudio: { notes: { frequency: number; scheduled: boolean }[] } }).challengeAudio;
    return data.notes.filter(n => n.scheduled && Math.abs(n.frequency - 1046.502) < 1).length;
  }), { intervals: [10] }).toBeGreaterThanOrEqual(index + 1);
  await page.evaluate(index => {
    const data = (window as unknown as { challengeAudio: { context: AudioContext; notes: { frequency: number; when: number; scheduled: boolean }[] } }).challengeAudio;
    const note = data.notes.filter(n => n.scheduled && Math.abs(n.frequency - 1046.502) < 1)[index];
    const ts = data.context.getOutputTimestamp();
    const stamp = ts.contextTime && ts.performanceTime
      ? ts.performanceTime + (note.when - ts.contextTime) * 1000
      : performance.now() + (note.when - data.context.currentTime + data.context.baseLatency + (data.context.outputLatency || 0)) * 1000;
    const event = new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', button: 0 });
    Object.defineProperty(event, 'timeStamp', { value: stamp });
    document.querySelector('[data-pitch="84"]')!.dispatchEvent(event);
  }, index);
}

test('challenge entry, settings, touch targets, stop, and browser history work on phones and desktop', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#colonel-bogey');
  await page.getByRole('button', { name: 'Bell lyre challenge' }).click();
  await expect(page).toHaveURL(/#colonel-bogey\/challenge$/);
  await expect(page).toHaveTitle('SLSCC Band');
  await expect(page.getByRole('heading', { name: 'Play for ten stars' })).toBeVisible();
  await expect(page.locator('.app-header, .catalogue, .practice')).toHaveCount(0);
  await expect(page.getByLabel('Practice speed')).toHaveValue('75');
  await page.getByLabel('Practice speed').fill('50');
  await page.getByLabel('Advance note cues').uncheck();
  await page.getByLabel('Metronome', { exact: false }).check();
  await page.getByLabel('Bell lyre backing').check();
  await page.screenshot({ path: path.join(tmpdir(), 'marching-band-challenge-setup.png'), fullPage: true });
  await page.getByRole('button', { name: 'Start attempt' }).click();
  await expect(page.locator('.game-running')).toBeVisible();
  await expect(page.locator('.game-playing-status')).toContainText('Count in');
  await expect(page.getByRole('slider')).toHaveCount(0);
  await expect(page.locator('.game-bar')).toHaveCount(25);
  await expect(page.locator('.game-bar.cued')).toHaveCount(0);
  await expect(page.locator('.game-music')).toHaveCount(0);
  await expect(page.locator('.game-playing-status small')).toHaveCount(0);
  await page.getByRole('button', { name: 'Play C6', exact: true }).dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: path.join(tmpdir(), 'marching-band-challenge-phone.png') });
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    const boxes = await page.locator('.game-bar').evaluateAll(bars => bars.map(b => { const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    expect(boxes.every(b => b.x >= 0 && b.y >= 0 && b.x + b.width <= viewport.width && b.y + b.height <= viewport.height)).toBe(true);
    expect(boxes.every(b => b.width >= 100 && b.height >= 24)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  }
  await page.screenshot({ path: path.join(tmpdir(), 'marching-band-challenge-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Play for ten stars' })).toBeVisible();
  await expect(page.getByLabel('Practice speed')).toHaveValue('50');
  await page.goBack();
  await expect(page.locator('.practice')).toBeVisible();
  await page.goForward();
  await expect(page.locator('section.game-setup')).toBeVisible();
  await page.getByRole('button', { name: 'Back to score', exact: true }).click();
  await expect(page).toHaveURL(/#colonel-bogey$/);
  await page.goto('./#16obr');
  await expect(page.getByRole('button', { name: 'Bell lyre challenge' })).toHaveCount(0);
  await page.goto('./#16obr/challenge');
  await expect(page.getByRole('heading', { name: 'Bell lyre challenge unavailable' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a completed attempt reveals ten integer stars one by one with sounds and resets on retry', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const xml = `<museScore version="4.70"><Score><Division>480</Division>
    <Part><Staff id="1"><StaffType group="pitched" /></Staff><trackName>Bell Lyre</trackName><Instrument id="piano"><useDrumset>0</useDrumset></Instrument></Part>
    <Part><Staff id="2"><StaffType group="percussion" /></Staff><trackName>Side Drum</trackName><Instrument id="snare-drum"><useDrumset>1</useDrumset><Drum pitch="38"><name>Acoustic Snare</name><line>0</line></Drum></Instrument></Part>
    <Staff id="1"><Measure><voice><TimeSig><sigN>3</sigN><sigD>4</sigD></TimeSig><Tempo><tempo>2</tempo></Tempo>${'<Chord><durationType>quarter</durationType><Note><pitch>60</pitch><tpc>14</tpc></Note></Chord>'.repeat(3)}</voice></Measure></Staff>
    <Staff id="2"><Measure><voice><TimeSig><sigN>3</sigN><sigD>4</sigD></TimeSig>${'<Chord><durationType>quarter</durationType><Note><pitch>38</pitch><tpc>14</tpc></Note></Chord>'.repeat(3)}</voice></Measure></Staff>
  </Score></museScore>`;
  const archive = zipSync({ 'challenge.mscx': strToU8(xml) });
  await page.route('**/generated/scores/*colonel-bogey.mscz', route => route.fulfill({ body: Buffer.from(archive), contentType: 'application/octet-stream' }));
  await observeChallengeAudio(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#colonel-bogey/challenge');
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await page.getByRole('button', { name: 'Start attempt' }).click();
  await expect(page.getByRole('button', { name: 'Play C6', exact: true })).toHaveClass(/cued/);
  await expect(page.locator('.game-count-in')).toHaveText('Count in 2 / 3'); // cues now precede the old half-second window
  for (let index = 0; index < 3; index++) {
    await tapScheduledNote(page, index);
    await expect(page.locator('.game-playing-status')).toContainText('Perfect!');
    if (index < 2) await expect(page.locator('.game-perfect-streak')).toHaveCount(0);
  }
  await expect(page.locator('.game-perfect-streak')).toHaveText('✦Perfect streak ·3');
  expect(await page.locator('.game-perfect').evaluate(el => getComputedStyle(el).color)).toBe('rgb(121, 80, 189)');
  await page.screenshot({ path: path.join(tmpdir(), 'marching-band-challenge-streak.png') });
  await expect(page.locator('.game-result')).toBeVisible();
  await expect(page.locator('.game-star')).toHaveCount(10);
  await expect(page.locator('.game-star.filled')).toHaveCount(10, { timeout: 3000 });
  await expect(page.locator('.game-result-score')).toHaveText('10 / 10');
  await expect(page.locator('.game-aids')).toContainText('100% speed');
  await expect(page.locator('.game-best-streak')).toHaveText('Longest perfect streak3');
  const audio = await page.evaluate(() => {
    const data = (window as unknown as { challengeAudio: { counts: number[]; notes: { frequency: number }[] } }).challengeAudio;
    return { counts: data.counts, sounds: data.notes.length };
  });
  expect(audio.counts).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(audio.sounds).toBeGreaterThanOrEqual(23); // count-in, written note, tap, twenty star tones
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.game-star.filled').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.screenshot({ path: path.join(tmpdir(), 'marching-band-challenge-result.png'), fullPage: true });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.game-result')).toHaveCount(0);
  await expect(page.getByLabel('Practice speed')).toHaveValue('100');
  await page.getByRole('button', { name: 'Start attempt' }).click();
  await expect(page.locator('.game-count-in')).toHaveCount(0);
  await page.getByRole('button', { name: 'Play A5', exact: true }).dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await expect(page.locator('.game-playing-status')).toHaveText('');
  await expect(page.locator('.game-perfect-streak')).toHaveCount(0);
  await expect(page.locator('.game-result')).toBeVisible();
  await expect(page.locator('.game-result-score')).toHaveText('0 / 10');
  await expect(page.locator('.game-star.filled')).toHaveCount(0);
  await expect(page.locator('.game-best-streak')).toHaveText('Longest perfect streak0');
  await page.getByRole('button', { name: 'Back to score', exact: true }).last().click();
  await expect(page.locator('.practice')).toBeVisible();
  expect(errors).toEqual([]);
});

test('backgrounding an attempt cancels it without awarding a partial score', async ({ page }) => {
  await page.goto('./#colonel-bogey/challenge');
  await page.getByRole('button', { name: 'Start attempt' }).click();
  await expect(page.locator('.game-running')).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('section.game-setup')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Attempt interrupted');
  await expect(page.locator('.game-result')).toHaveCount(0);
});


test('streak tiers build gently while the counter stays anchored as alerts and digits change', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const notes = '<Chord><durationType>quarter</durationType><Note><pitch>60</pitch><tpc>14</tpc></Note></Chord>'.repeat(4);
  const measures = Array.from({ length: 8 }, (_, i) => `<Measure><voice>${i === 0 ? '<TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig><Tempo><tempo>4</tempo></Tempo>' : ''}${notes}</voice></Measure>`).join('');
  const xml = `<museScore version="4.70"><Score><Division>480</Division>
    <Part><Staff id="1"><StaffType group="pitched" /></Staff><trackName>Bell Lyre</trackName><Instrument id="piano"><useDrumset>0</useDrumset></Instrument></Part>
    <Staff id="1">${measures}<Measure><voice><Rest><durationType>whole</durationType></Rest></voice></Measure></Staff>
  </Score></museScore>`;
  const archive = zipSync({ 'challenge.mscx': strToU8(xml) });
  await page.route('**/generated/scores/*colonel-bogey.mscz', route => route.fulfill({ body: Buffer.from(archive), contentType: 'application/octet-stream' }));
  await observeChallengeAudio(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('./#colonel-bogey/challenge');
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await page.getByRole('button', { name: 'Start attempt' }).click();
  const counter = page.locator('.game-streak-count');
  const badge = page.locator('.game-perfect-streak');
  let anchor: { x: number; width: number } | undefined;
  for (let index = 0; index < 32; index++) {
    await tapScheduledNote(page, index);
    if (index < 2) continue;
    await expect(counter).toHaveText(String(index + 1));
    const box = (await counter.boundingBox())!;
    anchor ??= box;
    expect(box.x).toBeCloseTo(anchor.x, 1);
    expect(box.width).toBeCloseTo(anchor.width, 1);
    const tier = index >= 29 ? 'spark' : index >= 19 ? 'glow' : index >= 9 ? 'bright' : 'calm';
    await expect(badge).toHaveClass(new RegExp(`streak-${tier}`));
  }
  const spark = page.locator('.game-streak-spark');
  expect(await spark.evaluate(el => getComputedStyle(el).animationName)).toBe('streak-spark');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await spark.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.screenshot({ path: path.join(tmpdir(), 'marching-band-challenge-streak-spark.png') });
  await expect(page.locator('.game-perfect')).toHaveCount(0); // the alert expires during the final rest
  const quietBox = (await counter.boundingBox())!;
  expect(quietBox.x).toBeCloseTo(anchor!.x, 1);
  expect(quietBox.width).toBeCloseTo(anchor!.width, 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await expect(page.locator('.game-result')).toBeVisible();
  await expect(page.locator('.game-best-streak')).toHaveText('Longest perfect streak32');
  expect(errors).toEqual([]);
});
