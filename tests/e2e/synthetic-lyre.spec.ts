import { expect, test } from '@playwright/test';

test('lyre renders a warm metallic attack, a pitched decay and clean overlapping notes across its register', async ({ page }) => {
  await page.goto('./#colonel-bogey');
  const renders = await page.evaluate(async () => {
    const modulePath = '/src/audio/lyre.ts';
    const { LyreSynth } = await import(/* @vite-ignore */ modulePath);
    const results = [];
    for (const sampleRate of [22050, 44100, 48000]) {
      for (const pitch of [81, 93, 105]) {
        const context = new OfflineAudioContext(1, sampleRate * 4, sampleRate);
        const output = context.createGain(); output.gain.value = 0.2; output.connect(context.destination);
        const synth = new LyreSynth(context, () => {});
        synth.strike(0.05, pitch, 0.8, output);
        // Several overlapping strikes exercise headroom at the current master gain.
        for (const offset of [0, 4, 7, 12]) synth.strike(2.5, pitch + offset, 1, output, 0.1);
        const data = (await context.startRendering()).getChannelData(0);
        const rms = (from: number, to: number) => {
          const samples = data.subarray(Math.round(from * sampleRate), Math.round(to * sampleRate));
          return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        };
        const amplitude = (frequency: number, from: number, to: number) => {
          const start = Math.round(from * sampleRate), end = Math.round(to * sampleRate);
          let real = 0, imaginary = 0;
          for (let i = start; i < end; i++) {
            const phase = 2 * Math.PI * frequency * i / sampleRate;
            real += data[i] * Math.cos(phase); imaginary += data[i] * Math.sin(phase);
          }
          return 2 * Math.hypot(real, imaginary) / (end - start);
        };
        const fundamental = 440 * 2 ** ((pitch - 69) / 12);
        const early = amplitude(fundamental, 0.06, 0.1);
        results.push({ sampleRate, pitch, finite: data.every(Number.isFinite),
          peak: data.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0),
          early, metallic: amplitude(fundamental * 2.756, 0.06, 0.1) / early,
          lateMetallic: amplitude(fundamental * 2.756, 0.35, 0.45) / amplitude(fundamental, 0.35, 0.45),
          oddHarmonic: amplitude(fundamental * 3, 0.06, 0.1) / early,
          tail: rms(0.4, 0.5), silence: rms(2.35, 2.45), end: rms(3.3, 3.4),
        });
      }
    }
    return results;
  });
  for (const render of renders) {
    const label = `pitch ${render.pitch} at ${render.sampleRate} Hz`;
    expect(render.finite, label).toBe(true);
    expect(render.peak, label).toBeLessThan(0.5);
    expect(render.early, label).toBeGreaterThan(0.03);
    expect(render.metallic, label).toBeGreaterThan(0.02);
    expect(render.metallic, label).toBeLessThan(0.3);
    expect(render.lateMetallic, label).toBeLessThan(render.metallic * 0.5);
    expect(render.oddHarmonic, label).toBeLessThan(0.03);
    expect(render.tail, label).toBeGreaterThan(0.0001);
    expect(render.silence, label).toBeLessThan(0.000001);
    expect(render.end, label).toBeLessThan(0.000001);
  }
});
