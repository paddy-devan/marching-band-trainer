import { expect, test } from '@playwright/test';

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
  await page.getByRole('slider', { name: 'Playback position' }).fill(Math.max(0, firstCrash - 0.1).toFixed(2));
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

test('the recording retains its attack and tail, scales velocity, and overlaps without clipping', async ({ page }) => {
  await page.goto('./#heart-of-oak');
  const renders = await page.evaluate(async () => {
    const modulePath = '/src/audio/cymbal.ts';
    const { CymbalSample } = await import(/* @vite-ignore */ modulePath);
    const originalResponse = await fetch('/samples/490163__pjcohen__marching_hand_cymbal_pair_volume_24.wav');
    const originalBytes = await originalResponse.arrayBuffer();
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
      const original = await context.decodeAudioData(originalBytes.slice(0));
      const onset = (buffer: AudioBuffer) => buffer.getChannelData(0).findIndex(value => Math.abs(value) > 0.03) / rate;
      const rendered = await context.startRendering();
      const left = rendered.getChannelData(0), right = rendered.getChannelData(1);
      const rms = (from: number, to: number) => {
        const data = left.subarray(Math.round(from * rate), Math.round(to * rate));
        return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
      };
      results.push({ duration: recording.duration, channels: recording.numberOfChannels,
        onsetShift: Math.abs(onset(recording) - onset(original)),
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
    expect(render.onsetShift).toBeLessThan(0.005);
    expect(render.sharedBuffer).toBe(true);
    expect(render.finite).toBe(true);
    expect(render.peak).toBeLessThan(0.5);
    expect(render.attack).toBeGreaterThan(0.005);
    expect(render.tail).toBeGreaterThan(0.001);
    expect(render.lateTail).toBeGreaterThan(0.00001);
    expect(render.silence).toBe(0);
    expect(render.velocityRatio).toBeCloseTo(0.5, 2);
  }
});

