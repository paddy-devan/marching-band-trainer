import { expect, test } from '@playwright/test';
import { practiceTime } from './practice-clock';

test('fixed output increases real instrument levels and contains amplified mixed peaks', async ({ page }, testInfo) => {
  await page.goto('./#colonel-bogey');
  const results = await page.evaluate(async () => {
    const outputPath = '/src/audio/output.ts', lyrePath = '/src/audio/lyre.ts';
    const snarePath = '/src/audio/snare.ts', cymbalPath = '/src/audio/cymbal.ts';
    const [{ createMasterOutput }, { LyreSynth }, { SnareSynth }, { CymbalSample }] = await Promise.all([
      import(/* @vite-ignore */ outputPath), import(/* @vite-ignore */ lyrePath),
      import(/* @vite-ignore */ snarePath), import(/* @vite-ignore */ cymbalPath),
    ]);
    const results = [];
    for (const rate of [44100, 48000]) for (const voice of ['lyre', 'snare', 'mix']) {
      for (const mode of ['previous', 'current']) {
        const context = new OfflineAudioContext(2, rate * 2, rate);
        const output = mode === 'current' ? createMasterOutput(context) : context.createGain();
        if (mode === 'previous') { output.gain.value = 0.2; output.connect(context.destination); }
        const lyre = new LyreSynth(context, () => {});
        const snare = new SnareSynth(context, () => {});
        const cymbal = new CymbalSample(context, () => {});
        if (voice === 'mix') await cymbal.load();
        for (const at of [0.05, 0.3, 0.55, 0.8]) {
          if (voice === 'lyre') lyre.strike(at, 93, 0.8, output, 0.2);
          if (voice === 'snare') snare.strike(at, 0.8, output);
          if (voice === 'mix') {
            for (const pitch of [81, 85, 88, 93]) lyre.strike(at, pitch, 1, output, 0.2);
            snare.strike(at, 1.6, output);
            cymbal.strike(at, 1, output, 0.25);
            const bass = context.createOscillator();
            bass.frequency.value = 80;
            bass.connect(output); bass.start(at); bass.stop(at + 0.1);
          }
        }
        const rendered = await context.startRendering();
        let peak = 0, energy = 0, finite = true;
        for (let channel = 0; channel < rendered.numberOfChannels; channel++) {
          const data = rendered.getChannelData(channel);
          for (let i = 0; i < data.length; i++) {
            peak = Math.max(peak, Math.abs(data[i]));
            finite &&= Number.isFinite(data[i]);
            if (i < rate) energy += data[i] ** 2;
          }
        }
        results.push({ rate, voice, mode, peak, rms: Math.sqrt(energy / (rate * 2)), finite });
      }
    }
    return results;
  });
  await testInfo.attach('output-level-measurements', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  for (const render of results) {
    expect(render.finite).toBe(true);
    expect(render.peak).toBeLessThan(1);
    if (render.mode === 'current') {
      const previous = results.find(r => r.rate === render.rate && r.voice === render.voice && r.mode === 'previous')!;
      const minimumBoost = render.voice === 'mix' ? 2 : 7;
      expect(render.rms / previous.rms, render.voice).toBeGreaterThan(minimumBoost);
    }
  }
});

test('amplified playback works without an overall volume control on desktop and phone', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  await page.addInitScript(() => {
    const original = AudioContext.prototype.createWaveShaper;
    let attached = false;
    AudioContext.prototype.createWaveShaper = function () {
      const limiter = original.call(this);
      // The second shaper is the final peak guard, after oversampling.
      if (!attached) { attached = true; return limiter; }
      const analyser = this.createAnalyser();
      analyser.fftSize = 1024;
      // Read the actual limited output, with no second path to the speaker.
      limiter.connect(analyser);
      Object.assign(window, { masterRms: () => {
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        return Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length);
      } });
      return limiter;
    };
  });
  const rms = () => page.evaluate(() => (window as unknown as { masterRms?: () => number }).masterRms?.() || 0);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`./?volume-check=${width}#16obr`);
    await expect(page).toHaveTitle('SLSCC Band');
    await expect(page).toHaveURL(/#16obr$/);
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await expect(page.getByRole('slider', { name: 'Overall volume', exact: true })).toHaveCount(0);
    await expect(page.locator('.part-controls details')).not.toHaveAttribute('open');
    await page.getByRole('switch', { name: 'Metronome' }).check();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(() => practiceTime(page)).toBeGreaterThan(0.2);
    await expect.poll(rms, { intervals: [20] }).toBeGreaterThan(0.01);
    const before = await practiceTime(page);
    await expect.poll(() => practiceTime(page)).toBeGreaterThan(before + 0.2);
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/marching-band-volume-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(rms, { intervals: [20] }).toBeLessThan(0.000001);
  }
  expect(errors).toEqual([]);
});
