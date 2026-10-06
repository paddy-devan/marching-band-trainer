import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Transport } from '../src/audio/transport';
import { interpretScore } from '../src/score/interpret';
import { parseScore } from '../src/score/parser';
import { chord, measure, synthetic, tempo, time } from './helpers';

class FakeParam {
  value = 0;
  calls: { value: number; time: number }[] = [];
  setValueAtTime(value: number, time: number) { this.value = value; this.calls.push({ value, time }); }
  linearRampToValueAtTime(value: number, time: number) { this.calls.push({ value, time }); }
  exponentialRampToValueAtTime(value: number, time: number) { this.calls.push({ value, time }); }
}
class FakeNode { connect = vi.fn(); disconnect = vi.fn(); }
class FakeSource extends FakeNode {
  frequency = new FakeParam();
  start = vi.fn(); stop = vi.fn(); type = ''; buffer?: unknown; onended?: () => void;
}
class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeContext {
  currentTime = 0; state = 'running'; sampleRate = 100; destination = new FakeNode();
  gains: FakeGain[] = []; sources: FakeSource[] = [];
  callbacks: (() => void)[] = [];
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  addEventListener(_type: string, callback: () => void) { this.callbacks.push(callback); }
  createGain() { const node = new FakeGain(); this.gains.push(node); return node; }
  createOscillator() { const node = new FakeSource(); this.sources.push(node); return node; }
  createBufferSource() { return this.createOscillator(); }
  createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  createBiquadFilter() { return Object.assign(new FakeNode(), { frequency: new FakeParam(), type: '' }); }
}
function setup() {
  const score = parseScore(synthetic([
    measure(time() + chord('whole')) + measure(chord('whole')),
    measure(tempo(120) + chord('whole', 38)) + measure(chord('whole', 38)),
  ]), 'test');
  const context = new FakeContext();
  const transport = new Transport(interpretScore(score), () => context as unknown as AudioContext);
  return { score, context, transport };
}
describe('audio-clock transport', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('starts once, derives position from the audio clock, and cancels stale sounds on pause/seek', async () => {
    const { context, transport } = setup();
    await Promise.all([transport.play(), transport.play()]);
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(context.sources).toHaveLength(2);
    context.currentTime = 0.735;
    vi.advanceTimersByTime(25);
    expect(transport.getSnapshot().position).toBeCloseTo(0.7);
    transport.pause();
    expect(vi.getTimerCount()).toBe(0);
    expect(context.sources.every(s => s.stop.mock.calls.some(args => args.length === 0))).toBe(true);
    context.currentTime = 10;
    expect(transport.getSnapshot().position).toBeCloseTo(0.7);
    transport.seek(2);
    expect(transport.getSnapshot().position).toBe(2);
    await transport.play();
    const newSources = context.sources.slice(2);
    expect(newSources).toHaveLength(2);
    expect(newSources.every(s => s.start.mock.calls[0][0] >= 10)).toBe(true);
    transport.dispose();
  });
  it('changes speed without changing pitch and cancels old sources when restarting', async () => {
    const { context, transport } = setup();
    await transport.play();
    const pitch = context.sources[0].frequency.calls[0].value;
    context.currentTime = 0.535;
    transport.setSpeed(0.5);
    expect(transport.getSnapshot().position).toBeCloseTo(0.5);
    expect(context.sources.at(-1)!.frequency.calls[0].value).toBe(pitch);
    expect(context.sources[0].stop.mock.calls.some(args => args.length === 0)).toBe(true);
    context.currentTime = 1.57;
    vi.advanceTimersByTime(25);
    expect(transport.getSnapshot().position).toBeCloseTo(1);
    transport.restart();
    expect(transport.getSnapshot().position).toBe(0);
    expect(transport.getSnapshot().playing).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    transport.dispose();
  });
  it('changes per-part gains immediately without moving the transport', async () => {
    const { context, transport, score } = setup();
    await transport.play();
    const [piano, snare] = score.parts;
    transport.setMix({ [piano.id]: { muted: true, solo: false }, [snare.id]: { muted: false, solo: false } });
    expect(context.gains[1].gain.value).toBe(0);
    expect(context.gains[2].gain.value).toBe(1);
    transport.setMix({ [piano.id]: { muted: false, solo: true }, [snare.id]: { muted: false, solo: false } });
    expect(context.gains[1].gain.value).toBe(1);
    expect(context.gains[2].gain.value).toBe(0);
    expect(transport.getSnapshot().position).toBe(0);
    transport.dispose();
  });
  it('handles completion, suspended contexts and cancellation during pending resume', async () => {
    const { context, transport } = setup();
    await transport.play();
    context.currentTime = 4.1;
    vi.advanceTimersByTime(25);
    expect(transport.getSnapshot()).toMatchObject({ playing: false, position: 4 });
    expect(vi.getTimerCount()).toBe(0);
    await transport.play();
    expect(transport.getSnapshot().playing).toBe(true);
    context.state = 'suspended';
    context.callbacks.forEach(callback => callback());
    expect(transport.getSnapshot().playing).toBe(false);
    expect(transport.getSnapshot().status).toMatch(/device/);
    transport.dispose();
    const pending = setup();
    let resolve!: () => void;
    pending.context.resume.mockImplementationOnce(() => new Promise<void>(r => { resolve = r; }));
    const started = pending.transport.play();
    pending.transport.pause();
    resolve(); await started;
    expect(pending.transport.getSnapshot().playing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    pending.transport.dispose();
  });
});
