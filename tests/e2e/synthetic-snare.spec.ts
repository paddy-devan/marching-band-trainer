import { expect, test } from '@playwright/test';

test('synthetic rolls retain distinct attacks at slow and fast speeds, with a natural tail and no clipping', async ({ page }) => {
  await page.goto('./#colonel-bogey');
  const renders = await page.evaluate(async () => {
    const modulePath = '/src/audio/snare.ts';
    const { SnareSynth } = await import(/* @vite-ignore */ modulePath);
    const results = [];
    for (const speed of [0.5, 0.75, 1, 1.5]) {
      const sampleRate = 44100;
      const interval = 60 / 116 / 8 / speed;
      const start = 0.05;
      const last = start + 7 * interval;
      const context = new OfflineAudioContext(2, Math.ceil((last + 0.6) * sampleRate), sampleRate);
      const output = context.createGain(); output.gain.value = 0.2; output.connect(context.destination);
      const synth = new SnareSynth(context, () => {});
      for (let i = 0; i < 8; i++) synth.strike(start + i * interval, 0.65, output);
      const rendered = await context.startRendering();
      const data = rendered.getChannelData(0);
      const rms = (from: number, to: number) => {
        const samples = data.subarray(Math.round(from * sampleRate), Math.round(to * sampleRate));
        return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      };
      const ratios = [];
      for (let i = 1; i < 7; i++) {
        const at = start + i * interval;
        ratios.push(rms(at + 0.002, at + 0.014) / rms(at + interval - 0.012, at + interval - 0.002));
      }
      results.push({ speed, ratios, peak: data.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0),
        tail: rms(last + 0.08, last + 0.12), silence: rms(last + 0.45, last + 0.5), finite: data.every(Number.isFinite) });
    }
    return results;
  });
  for (const render of renders) {
    expect(render.finite).toBe(true);
    expect(render.peak).toBeLessThan(1);
    expect(render.tail).toBeGreaterThan(0.00001);
    expect(render.silence).toBeLessThan(0.000001);
    for (const ratio of render.ratios) expect(ratio, `attack contrast at ${render.speed * 100}% speed`).toBeGreaterThan(1.5);
  }
});
