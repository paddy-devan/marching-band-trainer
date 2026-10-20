import { expect, test } from '@playwright/test';
import { practiceTime } from './practice-clock';

test('a soloed sampled cymbal sounds in practice and its ringing tail obeys mute and pause', async ({ page }) => {
  const errors: string[] = [];
  const sampleRequests: string[] = [];
  page.on('request', request => { if (request.url().endsWith('.m4a')) sampleRequests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const original = AudioContext.prototype.createGain;
    let attached = false;
    AudioContext.prototype.createGain = function () {
      const node = original.call(this);
      if (!attached) {
        attached = true;
        const analyser = this.createAnalyser();
        analyser.fftSize = 512;
        const silent = original.call(this); silent.gain.value = 0;
        node.connect(analyser); analyser.connect(silent); silent.connect(this.destination);
        Object.assign(window, { cymbalRms: () => {
          const data = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(data);
          return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
        } });
      }
      return node;
    };
  });
  await page.goto('./#heart-of-oak');
  await page.locator('.part-controls summary').click();
  await expect(page.getByRole('button', { name: 'Solo Cymbal', exact: true })).toBeVisible();
  const firstCrash = await page.evaluate(async () => {
    const modulePath = '/src/score/loader.ts';
    const { loadCatalogue, loadScore } = await import(/* @vite-ignore */ modulePath);
    const entries = await loadCatalogue();
    const timeline = await loadScore(entries.find((entry: { id: string }) => entry.id === 'heart-of-oak'));
    const cymbal = timeline.score.parts.find((part: { name: string }) => part.name === 'Cymbal');
    return timeline.movements.find((movement: { partId: string }) => movement.partId === cymbal.id).time;
  });
  const rms = () => page.evaluate(() => (window as unknown as { cymbalRms?: () => number }).cymbalRms?.() || 0);
  await page.getByRole('button', { name: 'Solo Cymbal', exact: true }).click();
  await practiceTime(page, Math.max(0, firstCrash - 0.1));
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(rms, { intervals: [20] }).toBeGreaterThan(0.001);
  await page.getByRole('button', { name: 'Mute Cymbal', exact: true }).click();
  await expect.poll(rms, { intervals: [20] }).toBeLessThan(0.000001);
  await page.getByRole('button', { name: 'Mute Cymbal', exact: true }).click();
  await expect.poll(rms, { intervals: [20] }).toBeGreaterThan(0.0001);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(rms, { intervals: [20] }).toBeLessThan(0.000001);
  expect(errors).toEqual([]);
  expect(sampleRequests).toHaveLength(1);
  expect(sampleRequests[0]).toContain('marching-hand-cymbal');
});

test('the main crash lands on the beat, retains its tail, scales velocity, and overlaps without clipping', async ({ page }) => {
  await page.goto('./#heart-of-oak');
  const renders = await page.evaluate(async () => {
    const modulePath = '/src/audio/cymbal.ts';
    const { CymbalSample } = await import(/* @vite-ignore */ modulePath);
    const results = [];
    for (const rate of [44100, 48000]) {
      const context = new OfflineAudioContext(2, rate * 14, rate);
      const output = context.createGain(); output.gain.value = 0.2; output.connect(context.destination);
      const sources: AudioBufferSourceNode[] = [];
      const cymbal = new CymbalSample(context, (source: AudioScheduledSourceNode) => sources.push(source as AudioBufferSourceNode));
      await cymbal.load();
      cymbal.strike(0.05, 1, output);
      cymbal.strike(0.17, 1, output);
      cymbal.strike(0.29, 1, output);
      cymbal.strike(12.3, 0.5, output);
      const recording = sources[0].buffer!;
      const rendered = await context.startRendering();
      const left = rendered.getChannelData(0), right = rendered.getChannelData(1);
      // Ignore the quieter contact noise: the main crash must arrive on the beat.
      const onset = left.findIndex((value, i) => Math.max(Math.abs(value), Math.abs(right[i])) > 0.05) / rate;
      const rms = (from: number, to: number) => {
        const data = left.subarray(Math.round(from * rate), Math.round(to * rate));
        return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
      };
      results.push({ duration: recording.duration, channels: recording.numberOfChannels,
        onsetDelay: onset - 0.05, beforeBeat: rms(0, 0.05),
        sharedBuffer: sources.every(source => source.buffer === recording && source.playbackRate.value === 1 && !source.loop),
        finite: left.every(Number.isFinite) && right.every(Number.isFinite),
        peak: left.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0),
        attack: rms(0.055, 0.095), tail: rms(0.8, 1), lateTail: rms(2.3, 2.6),
        silence: rms(11.7, 12), velocityRatio: rms(12.305, 12.345) / rms(0.055, 0.095),
      });
    }
    return results;
  });
  for (const render of renders) {
    expect(render.duration).toBeCloseTo(11.015, 1);
    expect(render.channels).toBe(2);
    expect(render.beforeBeat).toBe(0);
    expect(render.onsetDelay).toBeGreaterThanOrEqual(0);
    expect(render.onsetDelay).toBeLessThan(0.01);
    expect(render.sharedBuffer).toBe(true);
    expect(render.finite).toBe(true);
    expect(render.peak).toBeLessThan(0.5);
    expect(render.attack).toBeGreaterThan(0.005);
    expect(render.tail).toBeGreaterThan(0.001);
    expect(render.lateTail).toBeGreaterThan(0.00001);
    expect(render.silence).toBe(0);
    // Quiet contacts lose some brightness as well as level.
    expect(render.velocityRatio).toBeGreaterThan(0.1);
    expect(render.velocityRatio).toBeLessThan(0.4);
  }
});

test('Captain General dynamics change level and brightness, and its tied crash rings past a short hit', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto('./#the-captain-general');
  await expect(page).toHaveTitle('SLSCC Band');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The Captain General');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  const results = await page.evaluate(async () => {
    const cymbalPath = '/src/audio/cymbal.ts', loaderPath = '/src/score/loader.ts';
    const { CymbalSample } = await import(/* @vite-ignore */ cymbalPath);
    const { loadCatalogue, loadScore } = await import(/* @vite-ignore */ loaderPath);
    const entries = await loadCatalogue();
    const timeline = await loadScore(entries.find((entry: { id: string }) => entry.id === 'the-captain-general'));
    const part = timeline.score.parts.find((part: { name: string }) => /cymbal/i.test(part.name));
    const movements = timeline.movements.filter((movement: { partId: string }) => movement.partId === part.id);
    const pp = movements.find((m: { velocity: number }) => Math.abs(m.velocity - 49 / 127) < 1e-6);
    const mp = movements[0];
    const accent = movements.find((m: { velocity: number }) => m.velocity > mp.velocity);
    const tied = movements.find((m: { sourceIds: string[] }) => m.sourceIds.length > 1);
    const results = [];
    for (const rate of [44100, 48000]) {
      const context = new OfflineAudioContext(2, rate * 10, rate);
      const output = context.createGain(); output.gain.value = 0.2; output.connect(context.destination);
      const sources: AudioBufferSourceNode[] = [];
      const cymbal = new CymbalSample(context, (source: AudioScheduledSourceNode) => sources.push(source as AudioBufferSourceNode));
      await cymbal.load();
      cymbal.strike(0.05, pp.velocity, output, pp.seconds);
      cymbal.strike(2.05, mp.velocity, output, pp.seconds);
      cymbal.strike(4.05, accent.velocity, output, pp.seconds);
      cymbal.strike(6.05, tied.velocity, output, tied.seconds);
      const rendered = await context.startRendering();
      const data = rendered.getChannelData(0);
      const energy = (from: number, to: number) => {
        const slice = data.subarray(Math.round(from * rate), Math.round(to * rate));
        const rms = Math.sqrt(slice.reduce((sum, value) => sum + value * value, 0) / slice.length);
        const difference = Math.sqrt(slice.reduce((sum, value, i) => sum + (i ? (value - slice[i - 1]) ** 2 : 0), 0) / slice.length);
        return { rms, brightness: difference / rms };
      };
      const quiet = energy(0.055, 0.095), medium = energy(2.055, 2.095), accented = energy(4.055, 4.095);
      results.push({ rate, quiet, medium, accented, tiedSeconds: tied.seconds, shortSeconds: pp.seconds,
        shortTail: energy(0.95, 1.05).rms, tiedTail: energy(6.95, 7.05).rms,
        damped: energy(6.05 + tied.seconds + 0.3, 6.05 + tied.seconds + 0.4).rms,
        tiedNotes: tied.sourceIds.length, attacks: sources.length,
        unchangedPitch: sources.every(source => source.playbackRate.value === 1),
        finite: data.every(Number.isFinite),
      });
    }
    return results;
  });
  await testInfo.attach('cymbal-render-measurements', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  for (const result of results) {
    expect(result.quiet.rms / result.medium.rms).toBeGreaterThan(0.2);
    expect(result.quiet.rms / result.medium.rms).toBeLessThan(0.75);
    expect(result.accented.rms / result.medium.rms).toBeGreaterThan(1.3);
    expect(result.quiet.brightness).toBeLessThan(result.medium.brightness * 0.9);
    expect(result.accented.brightness).toBeGreaterThan(result.medium.brightness);
    expect(result.shortTail).toBe(0);
    expect(result.tiedTail).toBeGreaterThan(0.0001);
    expect(result.damped).toBe(0);
    expect(result.tiedSeconds).toBeGreaterThan(result.shortSeconds * 2);
    expect(result.tiedNotes).toBe(2);
    expect(result.attacks).toBe(4);
    expect(result.unchangedPitch).toBe(true);
    expect(result.finite).toBe(true);
  }
  await page.locator('.part-controls summary').click();
  await page.getByRole('button', { name: /^Solo .*Cymbal/i }).click();
  await expect(page.getByRole('button', { name: /^Solo .*Cymbal/i })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => practiceTime(page)).toBeGreaterThan(0.1);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: '50%', exact: true }).click();
  await expect(page.locator('#speed')).toHaveValue('50');
  await page.screenshot({ path: '/tmp/captain-general-cymbal-check.png' });
  await testInfo.attach('captain-general-cymbal-controls', { path: '/tmp/captain-general-cymbal-check.png', contentType: 'image/png' });
  expect(errors).toEqual([]);
});

