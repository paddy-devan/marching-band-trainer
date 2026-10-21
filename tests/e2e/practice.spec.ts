import { expect, test } from '@playwright/test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readdirSync } from 'node:fs';
import { practiceTime } from './practice-clock';
import { strToU8, zipSync } from 'fflate';

const scoreCount = readdirSync('scores').filter(file => file.endsWith('.mscz')).length;

test('desktop practice controls change real playback and keep following independent of listening', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto('./#16obr');
  await expect(page).toHaveTitle('SLSCC Band');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('16 Bar Off Beat Routine (16 OBR)');
  await expect(page.locator('.catalogue .score-choice')).toHaveCount(scoreCount);
  await expect(page.locator('.speed-heading output')).toHaveText('116 BPM100%');
  await expect(page.locator('.transport-controls .part-controls')).toBeVisible();
  await expect(page.locator('.visual-heading')).not.toContainText('Visualisation');
  await expect(page.getByRole('combobox', { name: 'Visualised instrument' })).toBeVisible();
  await expect(page.locator('.visual-panel .challenge-button')).toHaveCount(0);
  await expect(page.locator('.part-controls').getByRole('combobox')).toHaveCount(0);
  await expect(page.locator('#speed')).toHaveAttribute('min', '50');
  await expect(page.locator('#speed')).toHaveAttribute('max', '125');
  await expect(page.locator('.tempo-controls .speed-presets button')).toHaveText(['50%', '60%', '80%', '90%', '100%']);
  const mixer = page.locator('.part-controls details');
  await expect(mixer).not.toHaveAttribute('open');
  await expect(page.getByRole('slider', { name: 'Side Drum volume' })).toBeHidden();
  await mixer.locator('summary').click();
  await expect(page.getByRole('slider', { name: 'Side Drum volume' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mute Side Drum' })).toHaveText('M');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  const seek = page.getByRole('slider', { name: 'Playback position' });
  await expect(seek).toHaveAttribute('min', '1');
  await expect(seek).toHaveAttribute('step', '1');
  await expect(page.locator('.time-readout, .bar-readout small')).toHaveCount(0);
  await expect.poll(() => practiceTime(page)).toBeGreaterThan(0.2);
  await mixer.locator('summary').click();
  await expect(page.getByRole('slider', { name: 'Side Drum volume' })).toBeHidden();
  const beforeCollapse = await practiceTime(page);
  await expect.poll(() => practiceTime(page)).toBeGreaterThan(beforeCollapse + 0.2);
  await expect(mixer).not.toHaveAttribute('open');
  await mixer.locator('summary').click();
  await expect(page.getByRole('slider', { name: 'Side Drum volume' })).toBeVisible();
  await page.getByRole('button', { name: 'Mute Side Drum' }).click();
  await expect(page.getByRole('button', { name: 'Mute Side Drum' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'Visualised instrument' }).locator('option:checked')).toHaveText('Side Drum');
  await page.getByRole('button', { name: 'Solo Bass Drum' }).click();
  await expect(page.getByRole('button', { name: 'Solo Bass Drum' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'Visualised instrument' }).locator('option:checked')).toHaveText('Side Drum');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await practiceTime(page);
  await page.waitForTimeout(150);
  expect(await practiceTime(page)).toBe(paused);
  for (const speed of [60, 80, 90, 100]) {
    await page.getByRole('button', { name: `${speed}%`, exact: true }).click();
    await expect(page.locator('#speed')).toHaveValue(String(speed));
  }
  await page.locator('#speed').fill('125');
  await expect(page.locator('.speed-heading output')).toHaveText('145 BPM125%');
  await page.getByRole('button', { name: '50%', exact: true }).click();
  await expect(page.locator('#speed')).toHaveValue('50');
  await expect(page.locator('.speed-heading output')).toHaveText('58 BPM50%');
  await seek.fill('8');
  await expect(seek).toHaveValue('8');
  await expect(page.locator('.bar-readout strong')).toHaveText('Bar 8 / 16');
  await seek.press('ArrowRight');
  await expect(page.locator('.bar-readout strong')).toHaveText('Bar 9 / 16');
  await seek.press('Home');
  await expect(seek).toHaveValue('1');
  await seek.press('End');
  await expect(page.locator('.bar-readout strong')).toHaveText('Bar 16 / 16');
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(seek).toHaveValue('1');
  expect(await practiceTime(page)).toBe(0);
  await page.getByRole('button', { name: /Colonel Bogey/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Colonel Bogey');
  await expect(page.locator('.piece-heading').getByText('Kenneth J. Alford', { exact: true })).toBeVisible();
  await expect(page.locator('.key-signature, .column-label')).toHaveCount(0);
  await expect(page.locator('.catalogue .score-list')).not.toContainText(/\d+ bars|\d+ parts/);
  await expect(page.locator('.piece-meta')).toHaveCount(0);
  await expect(page.locator('.bar-notes-row.current')).toHaveAttribute('aria-label', 'Current bar 1');
  await expect(page.locator('.bar-notes-row.queued')).toHaveAttribute('aria-label', 'Next bar 2');
  await expect(page.locator('.lyre-bar')).toHaveCount(25);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const beater = page.locator('.mallet');
  await expect(beater).toBeVisible();
  const firstHead = await beater.locator('circle').boundingBox();
  const firstBar = await page.locator('.lyre-bar.lit').boundingBox();
  const headCentre = firstHead!.y + firstHead!.height / 2;
  expect(headCentre).toBeGreaterThan(firstBar!.y);
  expect(headCentre).toBeLessThan(firstBar!.y + firstBar!.height / 4);
  const startPose = await beater.getAttribute('style');
  await practiceTime(page, 0.2);
  const intermediatePose = await beater.getAttribute('style');
  expect(intermediatePose).not.toBe(startPose);
  await practiceTime(page, 0.4);
  expect(await beater.getAttribute('style')).not.toBe(intermediatePose);
  expect(Number(await seek.getAttribute('max'))).toBe(18);
  // Bar 2 opens with two adjacent G-sharps: both views must release and restrike.
  await practiceTime(page, 2.1);
  await expect(page.locator('.bar-notes-row.current .note-cue')).toHaveCount(10);
  await expect(page.locator('.bar-notes-row.current .note-cue').nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.lyre-bar.lit')).toHaveCount(1);
  await practiceTime(page, 2.3);
  await expect(page.locator('.bar-notes-row.current [aria-current="true"]')).toHaveCount(0);
  await expect(page.locator('.lyre-bar.lit')).toHaveCount(0);
  await expect(beater).toBeVisible();
  await practiceTime(page, 2.34);
  await expect(page.locator('.bar-notes-row.current .note-cue').nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.lyre-bar.lit')).toHaveCount(1);
  await practiceTime(page, 21);
  await expect(page.locator('.bar-readout strong')).toHaveText('Bar 3 / 14');
  await expect(page.locator('.bar-notes-row.current')).toHaveAttribute('aria-label', 'Current bar 3');
  await expect(page.locator('.bar-notes-row.queued')).toHaveAttribute('aria-label', 'Next bar 4');
  await practiceTime(page, 29);
  await expect(page.locator('.bar-readout strong')).toHaveText('Bar 11 / 14');
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await page.getByRole('combobox', { name: 'Visualised instrument' }).selectOption({ label: 'Side Drum' });
  await expect(page.locator('.bar-notes-row.current [aria-current="true"]')).toHaveText('R');
  await expect(page.locator('.practice-footer, .practice-tip, .catalogue-note, .register-note, .header-note')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Visualised instrument' }).selectOption({ label: 'Bell Lyre' });
  await expect(page.getByRole('combobox', { name: 'Visualised instrument' })).toHaveCount(1);
  await expect(page.locator('.bar-letter').filter({ hasText: 'C♯6' })).toHaveCount(1);
  await expect(page.locator('.bar-notes')).not.toContainText('♭');
  await expect(page.locator('.current-note, .upcoming')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(beater).toBeVisible();
  expect(await beater.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.screenshot({ path: path.join(tmpdir(), 'marching-band-desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('phone and tablet catalogue, instrument and primary controls fit and respond', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Scores');
  await expect(page.locator('.practice')).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search scores' }).fill('colonel');
  await expect(page.locator('.score-choice')).toHaveCount(1);
  await page.getByRole('button', { name: /Colonel Bogey/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Colonel Bogey');
  await expect(page.locator('.piece-heading')).toBeHidden();
  await expect(page.locator('.mobile-score-switcher')).not.toContainText('Current score');
  await expect(page.locator('.mobile-score-switcher p')).toHaveText('Kenneth J. Alford');
  const playback = page.locator('.playback-controls');
  const play = page.getByRole('button', { name: 'Play', exact: true });
  const visual = page.locator('.visual-panel');
  expect((await page.locator('.playback-row').boundingBox())!.height).toBe(44);
  for (const control of [play, page.getByRole('button', { name: 'Restart', exact: true }), page.locator('#seek')]) {
    const box = (await control.boundingBox())!;
    expect(box.height).toBe(44);
    expect(box.y).toBe((await play.boundingBox())!.y);
  }
  expect((await playback.boundingBox())!.y).toBeLessThan((await visual.boundingBox())!.y);
  expect((await play.boundingBox())!.y + (await play.boundingBox())!.height).toBeLessThan(844);
  await expect(page.locator('.note-octave').first()).toBeVisible();
  const octaveStyle = await page.locator('.note-octave').first().evaluate(el => ({
    size: parseFloat(getComputedStyle(el).fontSize),
    letterSize: parseFloat(getComputedStyle(el.parentElement!).fontSize),
    color: getComputedStyle(el).color,
    letterColor: getComputedStyle(el.parentElement!).color,
  }));
  expect(octaveStyle.size).toBeLessThan(octaveStyle.letterSize);
  expect(octaveStyle.color).not.toBe(octaveStyle.letterColor);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await visual.scrollIntoViewIfNeeded();
  expect(await playback.evaluate(el => getComputedStyle(el).position)).toBe('static');
  const playbackBox = (await playback.boundingBox())!;
  const visualBox = (await visual.boundingBox())!;
  expect(playbackBox.y + playbackBox.height).toBeLessThanOrEqual(visualBox.y);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('combobox', { name: 'Visualised instrument' }).selectOption({ label: 'Side Drum' });
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
  await page.goto('./#16obr');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('16 Bar Off Beat Routine (16 OBR)');
  await page.locator('.part-controls summary').click();
  await page.getByRole('button', { name: 'Solo Side Drum' }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(rms, { intervals: [30], timeout: 3000 }).toBeGreaterThan(0.0001);
  const volume = page.getByRole('slider', { name: 'Side Drum volume' });
  await volume.fill('0');
  await expect.poll(rms, { intervals: [30] }).toBeLessThan(0.000001);
  await volume.fill('40');
  await volume.focus();
  await expect(page.locator('.part-row').filter({ has: volume }).locator('output')).toBeVisible();
  await expect(page.locator('.part-row').filter({ has: volume }).locator('output')).toHaveText('40%');
  await expect.poll(rms, { intervals: [30], timeout: 3000 }).toBeGreaterThan(0.0001);
  await page.getByRole('button', { name: 'Mute Side Drum' }).click();
  await expect.poll(rms, { intervals: [30] }).toBeLessThan(0.000001);
  const metronome = page.getByRole('switch', { name: 'Metronome' });
  await metronome.check();
  await expect.poll(rms, { intervals: [15], timeout: 3000 }).toBeGreaterThan(0.0001);
  await metronome.uncheck();
  await expect.poll(rms, { intervals: [30] }).toBeLessThan(0.000001);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  const position = await practiceTime(page);
  await expect.poll(() => practiceTime(page)).toBeGreaterThan(position + 0.3);
  await expect(page.getByRole('combobox', { name: 'Visualised instrument' }).locator('option:checked')).toHaveText('Side Drum');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(rms, { intervals: [30] }).toBeLessThan(0.000001);
});

test('rhythm strips align notes with beats and keep dense bars readable on phones', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto('./#colonel-bogey');
  await page.locator('#seek').fill('2');
  const current = page.locator('.bar-notes-row.current');
  await expect(current.locator('.beat-mark span').filter({ hasText: /^\d$/ })).toHaveText(['1', '2', '3', '4']);
  const firstNote = (await current.locator('.note-label').first().boundingBox())!;
  const firstBeat = (await current.locator('.beat-mark').first().boundingBox())!;
  expect(firstNote.x + firstNote.width / 2).toBeCloseTo(firstBeat.x, 0);
  await practiceTime(page, 6 * 60 / 116); // Halfway through written bar 2.
  expect(await current.locator('.rhythm-playhead').evaluate(el => parseFloat((el as HTMLElement).style.left))).toBeCloseTo(50, 2);
  await page.setViewportSize({ width: 320, height: 667 });
  await practiceTime(page, 7.5 * 60 / 116);
  await expect(page.locator('.rhythm-scroll, .bar-notes-label')).toHaveCount(0);
  await expect(current.locator('.bar-notes-number')).toHaveText('2');
  const strip = current.locator('.rhythm-strip');
  expect(await strip.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect((await current.boundingBox())!.height).toBeLessThan(100);
  const head = (await current.locator('.rhythm-playhead').boundingBox())!;
  const viewport = (await strip.boundingBox())!;
  expect(head.x).toBeGreaterThanOrEqual(viewport.x);
  expect(head.x).toBeLessThan(viewport.x + viewport.width);
  const labels = await current.locator('.note-label').evaluateAll(els => els.map(el => {
    const box = el.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
  }));
  labels.forEach((label, i) => labels.slice(0, i).forEach(previous => {
    const overlapX = label.left < previous.right && label.right > previous.left;
    if (Math.abs(label.top - previous.top) < 0.5) expect(overlapX).toBe(false);
    else if (overlapX) expect(Math.min(label.bottom, previous.bottom) - Math.max(label.top, previous.top)).toBeLessThanOrEqual(2.1);
  }));
  await practiceTime(page, 2.1); // Safely inside the first attack after the saved tempo's rounding.
  const highlight = current.locator('.lit .note-highlight');
  const selectedFill = await highlight.evaluate(el => getComputedStyle(el).backgroundColor);
  const presetFill = await page.getByRole('button', { name: '100%', exact: true }).evaluate(el => getComputedStyle(el).backgroundColor);
  expect(selectedFill).toBe(presetFill);
  const circle = (await highlight.boundingBox())!;
  expect(circle.width).toBe(circle.height);
  expect(await highlight.evaluate(el => getComputedStyle(el).borderRadius)).toBe('50%');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const before = await practiceTime(page);
  await expect.poll(() => practiceTime(page)).toBeGreaterThan(before + 0.2);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect(errors).toEqual([]);
});

test('lyre semiquavers stay at exact onsets in two readable stationary rows on phones', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 667 });
  await page.goto('./#the-captain-general');
  const current = page.locator('.bar-notes-row.current');
  await expect(current.locator('.note-label')).toHaveCount(12);
  const measureLabels = () => current.locator('.note-label').evaluateAll(els => els.map(el => {
    const box = el.getBoundingClientRect();
    const cue = el.parentElement!.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height, onset: cue.x };
  }));
  const labels = await measureLabels();
  expect(new Set(labels.map(label => label.y)).size).toBe(2);
  for (const [i, label] of labels.entries()) {
    expect(label.x + label.width / 2).toBeCloseTo(label.onset, 1);
    expect(label.height).toBe(22);
    expect(label.x).toBeGreaterThanOrEqual(0);
    expect(label.x + label.width).toBeLessThanOrEqual(320);
    for (const other of labels.slice(0, i)) {
      const overlapX = label.x < other.x + other.width && label.x + label.width > other.x;
      if (Math.abs(label.y - other.y) < 0.5) expect(overlapX).toBe(false);
      else if (overlapX) expect(Math.min(label.y + label.height, other.y + other.height) - Math.max(label.y, other.y)).toBeLessThanOrEqual(2.1);
    }
  }
  expect((await current.boundingBox())!.height).toBeLessThan(100);
  const initialHead = (await current.locator('.rhythm-playhead').boundingBox())!.x;
  await practiceTime(page, 0.5);
  expect((await current.locator('.rhythm-playhead').boundingBox())!.x).toBeGreaterThan(initialHead + 10);
  expect(await measureLabels()).toEqual(labels);
});

test('note bars keep the mixer stationary through sparse, dense, silent and final bars', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  const geometry = () => page.evaluate(() => ({
    height: document.querySelector('.bar-notes')!.getBoundingClientRect().height,
    slots: [...document.querySelector('.bar-notes')!.children].map(el => el.getBoundingClientRect().height),
    mixer: document.querySelector('.part-controls')!.getBoundingClientRect().y + scrollY,
  }));
  await page.goto('./#hollyrood');
  const seek = page.locator('#seek');
  await seek.fill('10');
  const dense = await geometry();
  for (const bar of ['13', (await seek.getAttribute('max'))!]) {
    await seek.fill(bar);
    expect(await geometry()).toEqual(dense);
  }
  await expect(page.locator('.bar-notes-end')).toHaveText('End of score');
  await page.goto('./#balaklava');
  await page.getByRole('combobox', { name: 'Visualised instrument' }).selectOption({ label: 'Cymbal' });
  await expect(page.locator('.current .bar-rest')).toHaveText('Rest');
  const silent = await geometry();
  await seek.fill('2');
  await expect(page.locator('.current .note-label').first()).toBeVisible();
  expect(await geometry()).toEqual(silent);
});

test('bar seeking respects pickups, meter and tempo changes, and separate repeat passes', async ({ page }) => {
  const note = (duration: string, dots = '') => `<Chord><durationType>${duration}</durationType>${dots}<Note><pitch>60</pitch></Note></Chord>`;
  const meter = (numerator: number) => `<TimeSig><sigN>${numerator}</sigN><sigD>4</sigD></TimeSig>`;
  const tempo = (bpm: number) => `<Tempo><tempo>${bpm / 60}</tempo></Tempo>`;
  const xml = `<museScore version="4.70"><Score><Division>480</Division>
    <Part><Staff id="1"/><trackName>Piano</trackName><Instrument id="piano"/></Part>
    <Staff id="1">
      <Measure len="1/4"><voice>${meter(4)}${tempo(120)}${note('quarter')}</voice></Measure>
      <Measure><startRepeat/><voice>${note('half')}${tempo(60)}${note('half')}</voice></Measure>
      <Measure><voice>${meter(3)}${tempo(90)}${note('half', '<dots>1</dots>')}</voice><endRepeat>2</endRepeat></Measure>
      <Measure><voice>${meter(2)}${tempo(120)}${note('half')}</voice></Measure>
    </Staff></Score></museScore>`;
  await page.route('**/generated/scores/*16obr.mscz', route => route.fulfill({
    body: Buffer.from(zipSync({ 'bars.mscx': strToU8(xml) })), contentType: 'application/octet-stream',
  }));
  await page.goto('./#16obr');
  const seek = page.getByRole('slider', { name: 'Playback position', exact: true });
  await expect(seek).toHaveAttribute('max', '6');
  const bars = [1, 2, 3, 2, 3, 4];
  const starts = [0, 0.5, 3.5, 5.5, 8.5, 10.5];
  for (const [index, bar] of bars.entries()) {
    await seek.fill(String(index + 1));
    await expect(seek).toHaveValue(String(index + 1));
    await expect(page.locator('.bar-readout strong')).toHaveText(`Bar ${bar} / 4`);
    await expect(seek).toHaveAttribute('aria-valuetext', `Bar ${bar} of 4, played bar ${index + 1} of 6`);
    expect(await practiceTime(page)).toBeCloseTo(starts[index], 8);
  }
  await page.getByRole('button', { name: '50%', exact: true }).click();
  await seek.fill('4');
  expect(await practiceTime(page)).toBeCloseTo(5.5, 8);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => practiceTime(page)).toBeGreaterThan(5.5);
  await seek.fill('2');
  expect(await practiceTime(page)).toBeLessThan(0.7);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});

test('one malformed archive does not prevent the other scores from loading', async ({ page }) => {
  await page.route('**/generated/scores/*16obr.mscz', route => route.fulfill({ body: 'invalid archive' }));
  await page.goto('./#16obr');
  await expect(page.locator('.empty-state').getByRole('alert')).toContainText('Cannot open this MuseScore archive');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cannot load score');
  await page.getByRole('button', { name: /Colonel Bogey/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Colonel Bogey');
  await expect(page.getByRole('button', { name: /Holyrood/i })).toBeEnabled();
});
