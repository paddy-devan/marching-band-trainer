import { expect, test, type Page } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function shortDrumScore(page: Page, scoreXml?: string) {
  const note = '<Chord><durationType>quarter</durationType><Note><pitch>38</pitch></Note></Chord>';
  const xml = scoreXml ?? `<museScore version="4.70"><Score><Division>480</Division>
    <Part><Staff id="1"><StaffType group="percussion" /></Staff><trackName>Side Drum</trackName><Instrument id="snare-drum"><useDrumset>1</useDrumset><Drum pitch="38"><name>Acoustic Snare</name><line>0</line></Drum></Instrument></Part>
    <Staff id="1"><Measure><voice><TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig><Tempo><tempo>2</tempo></Tempo><Sticking><text>L</text></Sticking>${note}<Sticking><text>R</text></Sticking>${note}${note}${note}</voice></Measure></Staff>
  </Score></museScore>`;
  const archive = zipSync({ 'drums.mscx': strToU8(xml) });
  await page.route('**/generated/scores/*16obr.mscz', route => route.fulfill({ body: Buffer.from(archive), contentType: 'application/octet-stream' }));
  await page.addInitScript(() => {
    const original = AudioContext.prototype.createBufferSource;
    const data = { context: undefined as AudioContext | undefined, strikes: [] as { when: number; scheduled: boolean }[] };
    Object.assign(window, { drumAudio: data });
    AudioContext.prototype.createBufferSource = function () {
      data.context = this;
      const source = original.call(this);
      const start = source.start.bind(source);
      source.start = (when = 0) => { data.strikes.push({ when, scheduled: when > this.currentTime + 0.001 }); start(when); };
      return source;
    };
  });
}

async function strikeScheduled(page: Page, index: number, hand: 'L' | 'R', options: { keyboard?: boolean; repeat?: boolean; renderClock?: boolean } = {}) {
  await expect.poll(() => page.evaluate(() => {
    const data = (window as unknown as { drumAudio: { strikes: { scheduled: boolean }[] } }).drumAudio;
    return data.strikes.filter(s => s.scheduled).length;
  }), { intervals: [10] }).toBeGreaterThanOrEqual(index + 1);
  await page.evaluate(({ index, hand, options }) => {
    const data = (window as unknown as { drumAudio: { context: AudioContext; strikes: { when: number; scheduled: boolean }[] } }).drumAudio;
    const strike = data.strikes.filter(s => s.scheduled)[index];
    const ts = data.context.getOutputTimestamp?.();
    const stamp = options.renderClock ? performance.now() + (strike.when - data.context.currentTime + (data.context.baseLatency || 0)) * 1000
      : ts?.contextTime && ts.performanceTime
      ? ts.performanceTime + (strike.when - ts.contextTime) * 1000
      : performance.now() + (strike.when - data.context.currentTime + data.context.baseLatency + (data.context.outputLatency || 0)) * 1000;
    const event = options.keyboard
      ? new KeyboardEvent('keydown', { bubbles: true, key: hand === 'L' ? 'f' : 'j', repeat: options.repeat })
      : new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', button: 0, pointerId: hand === 'L' ? 1 : 2 });
    // Firefox rounds event/clock timestamps; stay just after the first attack
    // rather than accidentally creating a free count-in tap a fraction early.
    Object.defineProperty(event, 'timeStamp', { value: stamp + (options.renderClock ? 10 : 2) });
    document.querySelector(options.keyboard ? '.drum-board' : `[data-hand="${hand}"]`)!.dispatchEvent(event);
  }, { index, hand, options });
}

test('drum entry, shared settings, falling lanes, responsive pads, stop and history', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#colonel-bogey');
  await expect(page.getByRole('button', { name: 'Bell lyre challenge' })).toBeVisible();
  await page.getByRole('button', { name: 'Drum challenge', exact: true }).click();
  await expect(page).toHaveURL(/#colonel-bogey\/drum-challenge$/);
  await expect(page).toHaveTitle('SLSCC Band');
  await expect(page.getByRole('heading', { name: 'Play for ten stars' })).toBeVisible();
  await expect(page.getByLabel('Drum backing')).not.toBeChecked();
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await page.getByLabel('Metronome', { exact: false }).check();
  await page.getByLabel('Drum backing').check();
  await page.getByRole('button', { name: 'Start attempt' }).click();
  await expect(page.locator('.game-running')).toBeVisible();
  await expect(page.locator('.game-count-in')).toBeVisible();
  await expect(page.locator('.drum-pad')).toHaveCount(2);
  await expect(page.locator('.drum-note').first()).toBeVisible();
  const falling = page.locator('.drum-note').first();
  const before = await falling.evaluate(el => el.getBoundingClientRect().top);
  await expect.poll(() => falling.evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThan(before);
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 1440, height: 1000 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.game-header')).toHaveCount(1);
    const boxes = await page.locator('.drum-pad').evaluateAll(pads => pads.map(p => { const r = p.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    expect(boxes.every(b => b.width >= 100 && b.height >= 80 && b.x >= 0 && b.y >= 0 && b.x + b.width <= viewport.width && b.y + b.height <= viewport.height)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: path.join(tmpdir(), 'marching-band-drum-translucent-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: path.join(tmpdir(), 'marching-band-drum-translucent-phone.png') });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByLabel('Practice speed')).toHaveValue('100');
  await expect(page.getByLabel('Drum backing')).toBeChecked();
  await page.goBack();
  await expect(page.locator('.practice')).toBeVisible();
  await page.goForward();
  await expect(page.locator('section.game-setup')).toBeVisible();
  await page.getByRole('button', { name: 'Back to score', exact: true }).click();
  await expect(page).toHaveURL(/#colonel-bogey$/);
  await page.goto('./#16obr');
  await expect(page.getByRole('button', { name: 'Drum challenge', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('either-hand cues are single spanning bars and a perfect attempt shares lyre results and retry', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await shortDrumScore(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#16obr/drum-challenge');
  await page.getByRole('button', { name: '100%', exact: true }).click();
  // Observe audible backing attacks to anchor injected event timestamps.
  await page.getByLabel('Drum backing').check();
  await page.getByRole('button', { name: 'Start attempt' }).click();
  await expect(page.locator('.drum-note.left')).toBeVisible();
  await expect(page.locator('.drum-note.right')).toBeVisible();
  await expect(page.locator('.drum-note.either').first()).toHaveText('Either');
  const either = (await page.locator('.drum-note.either').first().boundingBox())!;
  const track = (await page.locator('.drum-track').boundingBox())!;
  expect(either.width / track.width).toBeGreaterThan(0.85);
  for (const [index, hand] of (['L', 'R', 'L', 'R'] as const).entries()) {
    await strikeScheduled(page, index, hand, { keyboard: index === 1 });
    await expect(page.locator('.game-playing-status')).toContainText('Perfect!');
  }
  await expect(page.locator('.game-result')).toBeVisible();
  await expect(page.locator('.game-result-score')).toHaveText('10 / 10', { timeout: 4000 });
  await expect(page.locator('.game-result-stats')).toHaveText('Perfect4Early / late0Missed0Extra / wrong0');
  await expect(page.locator('.game-best-streak')).toHaveText('Longest perfect streak4');
  await expect(page.locator('.game-aids')).toContainText('Drum backing on');
  const taps = await page.evaluate(() => (window as unknown as { drumAudio: { strikes: { scheduled: boolean }[] } }).drumAudio.strikes.filter(s => !s.scheduled).length);
  expect(taps).toBe(4);
  await page.screenshot({ path: path.join(tmpdir(), 'marching-band-drum-result.png'), fullPage: true });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByLabel('Practice speed')).toHaveValue('100');
  await expect(page.locator('.game-result')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('cues off gives no prompts while wrong hands miss, either hands score, and extra taps penalise', async ({ page }) => {
  await shortDrumScore(page);
  await page.goto('./#16obr/drum-challenge');
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await page.getByLabel('Drum backing').check();
  await page.getByLabel('Advance note cues').uncheck();
  await page.getByRole('button', { name: 'Start attempt' }).click();
  await expect(page.locator('.drum-note')).toHaveCount(0);
  await expect(page.locator('.drum-hit-target, .drum-hit-label')).toHaveCount(0);
  await page.screenshot({ path: path.join(tmpdir(), 'marching-band-drum-cues-off.png') });
  await strikeScheduled(page, 0, 'R');
  await expect(page.locator('.game-playing-status')).toContainText('Wrong hand');
  await expect(page.locator('[data-hand="R"]')).toHaveClass(/wrong/);
  await strikeScheduled(page, 1, 'R', { keyboard: true });
  await strikeScheduled(page, 2, 'L');
  await strikeScheduled(page, 3, 'R');
  await strikeScheduled(page, 3, 'L');
  await expect(page.locator('.game-playing-status')).toContainText('Extra tap');
  await expect(page.locator('.drum-note')).toHaveCount(0);
  await expect(page.locator('.game-result')).toBeVisible();
  await expect(page.locator('.game-result-stats')).toHaveText('Perfect3Early / late0Missed1Extra / wrong1');
  await expect(page.locator('.game-result-score')).toHaveText('7 / 10');
  await expect(page.locator('.game-aids')).toContainText('Cues off');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByLabel('Advance note cues')).not.toBeChecked();
  await page.getByRole('button', { name: 'Start attempt' }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('section.game-setup')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Attempt interrupted');
  await expect(page.locator('.game-result')).toHaveCount(0);
});

test('a drum challenge direct link reports an unavailable part without misreading the score ID', async ({ page }) => {
  const xml = '<museScore version="4.70"><Score><Division>480</Division><Part><Staff id="1"/><trackName>Piano</trackName><Instrument id="piano"/></Part><Staff id="1"><Measure><voice><TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig><Chord><durationType>whole</durationType><Note><pitch>60</pitch></Note></Chord></voice></Measure></Staff></Score></museScore>';
  const archive = zipSync({ 'piano.mscx': strToU8(xml) });
  await page.route('**/generated/scores/*16obr.mscz', route => route.fulfill({ body: Buffer.from(archive), contentType: 'application/octet-stream' }));
  await page.goto('./#16obr/drum-challenge');
  await expect(page.getByRole('heading', { name: 'Drum challenge unavailable' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to score' }).click();
  await expect(page.locator('.practice')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Drum challenge', exact: true })).toHaveCount(0);
});

test('simultaneous touch strikes score both hands while count-in taps and held keys add no penalty', async ({ page }) => {
  const xml = `<museScore version="4.70"><Score><Division>480</Division>
    <Part><Staff id="1"><StaffType group="percussion" /></Staff><trackName>Side Drum</trackName><Instrument id="snare-drum"><useDrumset>1</useDrumset><Drum pitch="38"><name>Right</name></Drum><Drum pitch="40"><name>Left</name></Drum></Instrument></Part>
    <Staff id="1"><Measure><voice><TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig><Tempo><tempo>2</tempo></Tempo><Chord><durationType>quarter</durationType><Note><pitch>38</pitch></Note><Note><pitch>40</pitch></Note></Chord><Rest><durationType>half</durationType><dots>1</dots></Rest></voice></Measure></Staff>
  </Score></museScore>`;
  await shortDrumScore(page, xml);
  await page.goto('./#16obr/drum-challenge');
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await page.getByLabel('Drum backing').check();
  await page.getByRole('button', { name: 'Start attempt' }).click();
  await expect(page.locator('.game-count-in')).toBeVisible();
  await page.keyboard.press('f');
  await page.getByRole('button', { name: 'Play right stick' }).dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await strikeScheduled(page, 0, 'L', { keyboard: true, repeat: true });
  await strikeScheduled(page, 0, 'L');
  await strikeScheduled(page, 1, 'R');
  await expect(page.locator('.game-result')).toBeVisible();
  await expect(page.locator('.game-result-stats')).toHaveText('Perfect2Early / late0Missed0Extra / wrong0');
  await expect(page.locator('.game-result-score')).toHaveText('10 / 10', { timeout: 4000 });
});

test('falling bars exactly overlap their outlines at the scored onset across screen sizes', async ({ page }) => {
  await shortDrumScore(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#16obr/drum-challenge');
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await page.getByLabel('Drum backing').check();
  await page.getByRole('button', { name: 'Start attempt' }).click();

  for (const index of [0, 2]) {
    // Pin the audible clock to a real scheduled attack so geometry is measured
    // at its scored time, rather than estimating a frame's animation position.
    await expect.poll(() => page.evaluate(index => {
      const data = (window as unknown as { drumAudio: { context?: AudioContext; strikes: { when: number; scheduled: boolean }[] } }).drumAudio;
      const strike = data.strikes.filter(s => s.scheduled)[index];
      return !!strike && !!data.context && data.context.currentTime >= strike.when;
    }, index), { intervals: [10] }).toBe(true);
    await page.evaluate(index => {
      const data = (window as unknown as { drumAudio: { context: AudioContext; strikes: { when: number; scheduled: boolean }[] } }).drumAudio;
      const when = data.strikes.filter(s => s.scheduled)[index].when;
      data.context.getOutputTimestamp = () => ({ contextTime: when, performanceTime: performance.now() });
    }, index);
    const note = page.locator(`.drum-note[data-time="${index / 2}"]`);
    const outline = page.locator(`.drum-hit-target.${index === 0 ? 'left' : 'either'}`);
    await expect(outline).toBeVisible();
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 1440, height: 1000 }]) {
      await page.setViewportSize(viewport);
      await expect.poll(async () => {
        const bar = await note.boundingBox();
        const target = await outline.boundingBox();
        return bar && target ? Math.abs(bar.y - target.y) : Infinity;
      }, { intervals: [10] }).toBeLessThan(0.5);
      const bar = (await note.boundingBox())!;
      const target = (await outline.boundingBox())!;
      expect(bar.x).toBeCloseTo(target.x, 1);
      expect(bar.width).toBeCloseTo(target.width, 1);
      expect(bar.height).toBeCloseTo(target.height, 1);
      const track = (await page.locator('.drum-track').boundingBox())!;
      expect(target.y + target.height).toBeLessThan(track.y + track.height);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(tmpdir(), `marching-band-drum-hit-${index === 0 ? 'left' : 'either'}.png`) });
  }
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});

test('default muted backing generates no drum sources while live taps respond immediately', async ({ page }) => {
  await shortDrumScore(page);
  await page.goto('./#16obr/drum-challenge');
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await expect(page.getByLabel('Drum backing')).not.toBeChecked();
  await page.getByRole('button', { name: 'Start attempt' }).click();
  await expect(page.locator('.game-count-in')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { drumAudio: { strikes: unknown[] } }).drumAudio.strikes.length)).toBe(0);
  await page.getByRole('button', { name: 'Play left stick' }).dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  // Automation may land outside a hit window; both judgements give feedback.
  await expect(page.locator('[data-hand="L"]')).toHaveClass(/\b(tapped|wrong)\b/);
  expect(await page.locator('[data-hand="L"]').evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  expect(await page.evaluate(() => (window as unknown as { drumAudio: { strikes: { scheduled: boolean }[] } }).drumAudio.strikes)).toEqual([{ when: expect.any(Number), scheduled: false }]);
});

test.describe('mobile audio clock', () => {
  test.use({ viewport: { width: 393, height: 851 }, hasTouch: true });

  test('invalid Android latency reports do not hide cues or prevent Perfect judgments', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await shortDrumScore(page);
    await page.addInitScript(() => {
      // Reproduce an output clock that remains before the count-in although
      // the rendering clock, written backing and player tap sounds all advance.
      Object.defineProperty(AudioContext.prototype, 'outputLatency', { configurable: true, get: () => 20 });
      AudioContext.prototype.getOutputTimestamp = function () {
        return { contextTime: this.currentTime - 20, performanceTime: performance.now() - 20000 };
      };
    });
    await page.goto('./#16obr/drum-challenge');
    await page.getByRole('button', { name: '75%', exact: true }).click();
    await page.getByLabel('Drum backing').check();
    await page.getByRole('button', { name: 'Start attempt' }).click();
    await expect(page.locator('.drum-note').first()).toBeVisible();
    const falling = page.locator('.drum-note').first();
    const before = await falling.evaluate(el => el.getBoundingClientRect().top);
    await expect.poll(() => falling.evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThan(before);
    for (const [index, hand] of (['L', 'R', 'L', 'R'] as const).entries()) {
      await strikeScheduled(page, index, hand, { renderClock: true });
      await expect(page.locator('.game-playing-status')).toContainText('Perfect!');
    }
    await expect(page.locator('.game-count-in')).toHaveCount(0);
    await page.screenshot({ path: path.join(tmpdir(), 'marching-band-drum-mobile-clock.png') });
    await expect(page.locator('.game-result')).toBeVisible();
    await expect(page.locator('.game-result-stats')).toHaveText('Perfect4Early / late0Missed0Extra / wrong0');
    await expect(page.locator('.game-result-score')).toHaveText('10 / 10', { timeout: 4000 });
    expect(errors).toEqual([]);
  });
});

test('an opening flam scores both strokes across the end of the count-in', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await shortDrumScore(page, `<museScore version="4.70"><Score><Division>480</Division><metaTag name="workTitle">Flam check</metaTag>
    <Part><Staff id="1"><StaffType group="percussion" /></Staff><trackName>Side Drum</trackName><Instrument id="snare-drum"><useDrumset>1</useDrumset>
      <Drum pitch="38"><name>Left stick</name><line>1</line></Drum><Drum pitch="40"><name>Right stick</name><line>-1</line></Drum></Instrument></Part>
    <Staff id="1"><Measure><voice><TimeSig><sigN>2</sigN><sigD>4</sigD></TimeSig><Tempo><tempo>2</tempo></Tempo>
      <Chord><acciaccatura/><durationType>eighth</durationType><Note><pitch>40</pitch></Note></Chord>
      <Chord><durationType>half</durationType><Note><pitch>38</pitch></Note></Chord>
    </voice></Measure></Staff></Score></museScore>`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#16obr/drum-challenge');
  await expect(page).toHaveTitle('SLSCC Band');
  await expect(page.getByRole('heading', { name: 'Flam check' })).toBeVisible();
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await page.getByLabel('Drum backing').check();
  await page.getByRole('button', { name: 'Start attempt' }).click();
  await expect(page.locator('.drum-note')).toHaveCount(2);
  await expect(page.locator('.drum-note.right')).toHaveText('R');
  await expect(page.locator('.drum-note.left')).toHaveText('L');
  const times = await page.locator('.drum-note').evaluateAll(notes => notes.map(note => Number(note.getAttribute('data-time'))));
  expect(times).toEqual([-0.035, 0]);
  await page.screenshot({ path: path.join(tmpdir(), 'mcalpine-flam-challenge-phone.png') });
  await strikeScheduled(page, 0, 'R');
  await strikeScheduled(page, 1, 'L');
  await expect(page.locator('.game-result-stats')).toHaveText('Perfect2Early / late0Missed0Extra / wrong0');
  const strikes = await page.evaluate(() => (window as unknown as { drumAudio: { strikes: { when: number; scheduled: boolean }[] } }).drumAudio.strikes.filter(s => s.scheduled));
  expect(strikes).toHaveLength(2);
  expect(strikes[1].when - strikes[0].when).toBeCloseTo(0.035, 5);
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('button', { name: 'Start attempt' }).click();
  await strikeScheduled(page, 3, 'L'); // Main hit alone leaves the grace stroke missed.
  await expect(page.locator('.game-result-stats')).toHaveText('Perfect1Early / late0Missed1Extra / wrong0');
  expect(errors).toEqual([]);
});

test('McAlpine labels flams and animates the lead and main hands on desktop and phone', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('./#mcalpine');
  await expect(page).toHaveTitle('SLSCC Band');
  await expect(page.getByRole('heading', { name: 'McAlpine', exact: true })).toBeVisible();
  const seek = page.getByRole('slider', { name: 'Playback position', exact: true });
  for (const [label, viewport] of [['desktop', { width: 1366, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(viewport);
    await seek.fill('0.19'); // Grace hand is low 25 ms before its contact.
    const graceAngle = await page.locator('.snare .left-stick').evaluate(el => Number((el as SVGElement).style.transform.match(/rotate\(([-\d.]+)deg\)/)![1]));
    expect(graceAngle).toBeCloseTo(39.5);
    await page.locator('.visual-panel').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(tmpdir(), `mcalpine-flam-preparation-${label}.png`) });
    await seek.fill('0.22'); // First grace stroke at 0.215; main hit remains at 0.25.
    await expect(page.locator('.snare [data-impact="left"]')).toHaveClass(/lit/);
    await expect(page.locator('.snare [data-impact="right"]')).not.toHaveClass(/lit/);
    await seek.fill('0.25');
    await expect(page.locator('.snare [data-impact="right"]')).toHaveClass(/lit/);
    await expect(page.locator('.current .note-cue').first()).toHaveText('R Flam');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.visual-panel').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(tmpdir(), `mcalpine-flam-${label}.png`) });
  }
  expect(errors).toEqual([]);
});
