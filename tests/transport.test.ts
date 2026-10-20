import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Transport } from '../src/audio/transport';
import { interpretScore } from '../src/score/interpret';
import { parseScore } from '../src/score/parser';
import { chord, fixture, measure, synthetic, tempo, time } from './helpers';

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
  gains: FakeGain[] = []; sources: FakeSource[] = []; convolvers: FakeNode[] = [];
  callbacks: (() => void)[] = [];
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  decodeAudioData = vi.fn(async (_data: ArrayBuffer) => this.createBuffer(2, this.sampleRate * 11, this.sampleRate));
  addEventListener(_type: string, callback: () => void) { this.callbacks.push(callback); }
  createGain() { const node = new FakeGain(); this.gains.push(node); return node; }
  createOscillator() { const node = new FakeSource(); this.sources.push(node); return node; }
  createBufferSource() { return this.createOscillator(); }
  createConvolver() { const node = new FakeNode(); this.convolvers.push(node); return node; }
  createBuffer(channels: number, length: number, rate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { duration: length / rate, numberOfChannels: channels, getChannelData: (channel: number) => data[channel] };
  }
  createBiquadFilter() { return Object.assign(new FakeNode(), { frequency: new FakeParam(), Q: new FakeParam(), type: '' }); }
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
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it.each([
    ['Side Drum', 'snare-drum', 'pp', 33], ['Side Drum', 'snare-drum', 'mf', 80], ['Side Drum', 'snare-drum', 'fff', 126],
    ['Bass Drum', 'bass-drum', 'pp', 33], ['Bass Drum', 'bass-drum', 'mf', 80], ['Bass Drum', 'bass-drum', 'fff', 126],
  ] as const)('boosts %s accents globally at %s/%s while preserving ordinary hits', async (name, instrument, dynamic, midi) => {
    const score = parseScore(synthetic([measure(time(2, 4) + tempo(120)),
      measure(`<Dynamic><subtype>${dynamic}</subtype></Dynamic>` +
        chord('quarter', 38, '<Articulation><subtype>articAccentAbove</subtype></Articulation>') + chord('quarter', 38))]), 'accents');
    Object.assign(score.parts[1], { name, instrument });
    const context = new FakeContext();
    const transport = new Transport(interpretScore(score), () => context as unknown as AudioContext);
    await transport.play();
    context.currentTime = 0.535;
    vi.advanceTimersByTime(25);
    const offset = instrument === 'bass-drum' ? 0.003 : 0.0015;
    const peakAt = (at: number) => context.gains.flatMap(g => g.gain.calls).find(c => Math.abs(c.time - at - offset) < 1e-8)!.value;
    const accent = peakAt(0.035), normal = peakAt(0.535);
    expect(normal).toBeCloseTo(midi / 127 * 0.65);
    expect(accent).toBeCloseTo(Math.min(1, midi / 127 / 0.72) * 1.6 * 0.65);
    expect(accent / normal).toBeGreaterThan(1.6);
    transport.dispose();
  });
  it.each([0.25, 1, 1.5])('schedules an opening flam before its main beat at %s speed and cancels both strokes', async speed => {
    const score = parseScore(synthetic([measure(time(2, 4) + tempo(120)),
      measure(chord('eighth', 38, '<acciaccatura/>') + chord('half', 38))]), 'flam');
    const context = new FakeContext();
    const transport = new Transport(interpretScore(score), () => context as unknown as AudioContext);
    transport.setSpeed(speed);
    await transport.play();
    context.currentTime = 0.1;
    vi.advanceTimersByTime(25);
    const strikes = context.sources.filter(s => s.buffer);
    expect(strikes).toHaveLength(2);
    expect(strikes[0].start.mock.calls[0][0]).toBeCloseTo(0.035);
    expect(strikes[1].start.mock.calls[0][0]).toBeCloseTo(0.035 + 0.035 / speed);
    transport.pause();
    expect(context.sources.every(s => s.stop.mock.calls.some(args => args.length === 0))).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const count = context.sources.length;
    transport.seek(0.5);
    await transport.play();
    expect(context.sources).toHaveLength(count); // No replay of a flam before the seek point.
    transport.restart();
    expect(context.sources.filter(s => s.buffer)).toHaveLength(3 + (speed >= 1 ? 1 : 0));
    transport.dispose();
  });
  it('includes an opening flam in the count-in lead-up without moving the main beat', async () => {
    const score = parseScore(synthetic([measure(time(2, 4) + tempo(120)),
      measure(chord('eighth', 38, '<acciaccatura/>') + chord('half', 38))]), 'flam');
    const context = new FakeContext();
    const transport = new Transport(interpretScore(score), () => context as unknown as AudioContext);
    await transport.play({ countIn: true });
    context.currentTime = 0.95;
    vi.advanceTimersByTime(25);
    const strikes = context.sources.filter(s => s.buffer);
    expect(strikes).toHaveLength(2);
    expect(strikes[0].start.mock.calls[0][0]).toBeCloseTo(1);
    expect(strikes[1].start.mock.calls[0][0]).toBeCloseTo(1.035);
    transport.dispose();
  });
  it('starts once, derives position from the audio clock, and cancels stale sounds on pause/seek', async () => {
    const { context, transport } = setup();
    await Promise.all([transport.play(), transport.play()]);
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(context.sources).toHaveLength(3);
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
    const newSources = context.sources.slice(3);
    expect(newSources).toHaveLength(3);
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
    expect([...context.sources].reverse().find(s => !s.buffer && s.type === 'triangle')!.frequency.calls[0].value).toBe(pitch);
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
  it('preserves each part volume through mute and solo changes', async () => {
    const { context, transport, score } = setup();
    const [piano, snare] = score.parts;
    const mix = { [piano.id]: { muted: false, solo: false, volume: 0.35 }, [snare.id]: { muted: false, solo: false, volume: 0.7 } };
    transport.setMix(mix);
    await transport.play();
    expect(context.gains[1].gain.value).toBe(0.35);
    expect(context.gains[2].gain.value).toBe(0.7);
    transport.setMix({ ...mix, [piano.id]: { ...mix[piano.id], muted: true } });
    expect(context.gains[1].gain.value).toBe(0);
    transport.setMix({ ...mix, [piano.id]: { ...mix[piano.id], solo: true } });
    expect(context.gains[1].gain.value).toBe(0.35);
    expect(context.gains[2].gain.value).toBe(0);
    transport.setMix(mix);
    expect(context.gains[2].gain.value).toBe(0.7);
    expect(transport.getSnapshot().position).toBe(0);
    transport.dispose();
  });
  it('toggles live metronome clicks without cancelling instrument notes or shifting the clock', async () => {
    const { context, transport } = setup();
    await transport.play();
    const instruments = [...context.sources];
    context.currentTime = 0.435;
    vi.advanceTimersByTime(25);
    transport.setMetronome(true);
    const click = context.sources.at(-1)!;
    expect(click.frequency.calls[0].value).toBe(1000);
    expect(click.start).toHaveBeenCalledWith(0.535);
    expect(transport.getSnapshot().position).toBeCloseTo(0.4);
    transport.setMetronome(false);
    expect(click.stop).toHaveBeenCalledWith();
    expect(instruments.every(source => !source.stop.mock.calls.some(args => args.length === 0))).toBe(true);
    transport.setMetronome(true);
    const nextClick = context.sources.at(-1)!;
    expect(nextClick).not.toBe(click);
    expect(nextClick.start).toHaveBeenCalledWith(0.535);
    transport.setSpeed(0.5);
    expect(nextClick.stop).toHaveBeenCalledWith();
    context.currentTime = 0.64;
    vi.advanceTimersByTime(25);
    expect(context.sources.at(-1)!.start.mock.calls[0][0]).toBeCloseTo(0.67);
    transport.pause();
    expect(transport.getSnapshot().metronome).toBe(true);
    await transport.play();
    expect(transport.getSnapshot().metronome).toBe(true);
    transport.dispose();
  });
  it('gives lyre notes a metal-bar spectrum and ringing tail, with every mode cancelled on pause', async () => {
    const score = parseScore(synthetic([measure(time() + tempo(120) + chord())]), 'test');
    const ring = async (lyre: boolean) => {
      score.parts[0].renderer = lyre ? 'lyre' : 'pulse';
      const context = new FakeContext();
      context.sampleRate = 44100;
      const transport = new Transport(interpretScore(score), () => context as unknown as AudioContext);
      await transport.play();
      return { context, transport };
    };
    const ordinary = await ring(false);
    const lyre = await ring(true);
    const source = lyre.context.sources[0];
    expect(source.type).toBe('sine');
    expect(source.stop.mock.calls[0][0] - source.start.mock.calls[0][0]).toBeCloseTo(0.95);
    expect(ordinary.context.sources[0].stop.mock.calls[0][0] - ordinary.context.sources[0].start.mock.calls[0][0]).toBeCloseTo(0.51);
    expect(source.frequency.calls).toEqual(ordinary.context.sources[0].frequency.calls);
    expect(lyre.context.sources).toHaveLength(4);
    expect(lyre.context.sources[1].frequency.calls[0].value / source.frequency.calls[0].value).toBeCloseTo(2.756);
    expect(lyre.context.sources.slice(1).every(s => s.stop.mock.calls[0][0] < source.stop.mock.calls[0][0])).toBe(true);
    lyre.transport.pause();
    for (const mode of lyre.context.sources) {
      expect(mode.stop).toHaveBeenCalledWith();
      mode.onended?.();
      expect(mode.disconnect).toHaveBeenCalled();
      expect((mode.connect.mock.calls[0][0] as FakeGain).disconnect).toHaveBeenCalled();
    }
    ordinary.transport.dispose(); lyre.transport.dispose();
  });
  it('uses the same transposed lyre voice for muted-backing taps and preserves its pitch at different speeds', async () => {
    const { context, transport, score } = setup();
    const part = score.parts[0];
    part.renderer = 'lyre';
    part.register.transpose = 24;
    context.sampleRate = 44100;
    transport.setMix({ [part.id]: { muted: true, solo: false } });
    await transport.play({ skipMuted: true });
    const tap = () => {
      const start = context.sources.length;
      transport.strike(part.id, 84);
      return context.sources.slice(start);
    };
    const first = tap();
    expect(first).toHaveLength(4);
    expect(first[0].frequency.calls[0].value).toBeCloseTo(1046.502);
    for (const mode of first) expect((mode.connect.mock.calls[0][0] as FakeGain).connect).toHaveBeenCalledWith(context.gains[0]);
    transport.setSpeed(0.5);
    const slower = tap();
    expect(slower.map(s => s.frequency.calls)).toEqual(first.map(s => s.frequency.calls));
    expect(slower.map(s => s.stop.mock.calls[0])).toEqual(first.map(s => s.stop.mock.calls[0]));
    transport.dispose();
    expect([...first, ...slower].every(s => s.stop.mock.calls.some(args => args.length === 0))).toBe(true);
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
  it('schedules a full count-in before the score, then clicks score beats on the same clock', async () => {
    const { context, transport } = setup();
    await transport.play({ countIn: true, metronome: true, outputTiming: true });
    expect(transport.getSnapshot().position).toBe(-2);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].frequency.calls[0].value).toBe(1400);
    context.currentTime = 2.035;
    vi.advanceTimersByTime(25);
    expect(transport.readPosition()).toBeCloseTo(0);
    expect(context.sources.some(s => s.frequency.calls[0]?.value === 1000)).toBe(false); // skipped clicks aren't replayed
    expect(context.sources.filter(s => s.start.mock.calls[0][0] === 2.035)).toHaveLength(4); // pitched note, snare noise/body and downbeat
    transport.dispose();
  });
  it('maps input event timestamps to output time independently of the 25ms UI snapshot', async () => {
    const { context, transport } = setup();
    await transport.play({ outputTiming: true });
    context.currentTime = 1.5;
    Object.assign(context, { getOutputTimestamp: () => ({ contextTime: 1, performanceTime: performance.now() }) });
    expect(transport.getSnapshot().position).toBe(0);
    expect(transport.readPosition(performance.now() - 20)).toBeCloseTo(0.945);
    context.currentTime = 4.2;
    Object.assign(context, { getOutputTimestamp: () => ({ contextTime: 3.95, performanceTime: performance.now() }) });
    vi.advanceTimersByTime(25);
    expect(transport.getSnapshot().playing).toBe(true); // wait for the audible end
    Object.assign(context, { getOutputTimestamp: () => ({ contextTime: 4.1, performanceTime: performance.now() }) });
    vi.advanceTimersByTime(25);
    expect(transport.getSnapshot().playing).toBe(false);
    transport.dispose();
  });
  it.each([-50, Infinity, NaN, 20])('keeps cues and input moving when output latency is invalid (%s)', async latency => {
    const { context, transport } = setup();
    Object.assign(context, {
      outputLatency: latency,
      getOutputTimestamp: () => ({ contextTime: -50, performanceTime: performance.now() }),
    });
    await transport.play({ countIn: true, outputTiming: true });
    context.currentTime = 2.535;
    expect(transport.readPosition()).toBeCloseTo(0.5);
    expect(transport.readPosition(performance.now() - 20)).toBeCloseTo(0.48);
    vi.advanceTimersByTime(25);
    expect(transport.getSnapshot().position).toBeCloseTo(0.5);
    context.currentTime = 6.1;
    vi.advanceTimersByTime(25);
    expect(transport.getSnapshot()).toMatchObject({ playing: false, position: 4 });
    transport.dispose();
  });

  it.each(['future', 'stale', 'infinite', 'throws'] as const)('falls back from a %s output timestamp without interrupting playback', async fault => {
    const { context, transport } = setup();
    await transport.play({ outputTiming: true });
    context.currentTime = 3.535;
    Object.assign(context, { baseLatency: 0.01, outputLatency: 0.025, getOutputTimestamp: () => {
      if (fault === 'throws') throw new Error('Output timestamp unavailable');
      return { contextTime: fault === 'future' ? 10 : fault === 'infinite' ? Infinity : 0.01, performanceTime: performance.now() };
    } });
    expect(transport.readPosition()).toBeCloseTo(3.465);
    expect(transport.readPosition(performance.now() - 20)).toBeCloseTo(3.445);
    transport.dispose();
  });

  it('retains normal output latency compensation and rejects invalid base latency', async () => {
    const { context, transport } = setup();
    await transport.play({ outputTiming: true });
    context.currentTime = 1.535;
    Object.assign(context, { baseLatency: 0.01, outputLatency: 0.2 });
    expect(transport.readPosition()).toBeCloseTo(1.29);
    Object.assign(context, { baseLatency: Infinity });
    expect(transport.readPosition()).toBeCloseTo(1.3);
    transport.dispose();
  });
  it('plays user strikes despite muted lyre backing, and cancels star sounds on exit', async () => {
    const { context, transport, score } = setup();
    const part = score.parts[0];
    part.register.transpose = 24;
    transport.setMix({ [part.id]: { muted: true, solo: false } });
    await transport.play();
    expect(context.gains[1].gain.value).toBe(0);
    transport.strike(part.id, 84);
    const manual = context.sources.at(-1)!;
    expect(manual.frequency.calls[0].value).toBeCloseTo(440 * 2 ** ((84 - 69) / 12));
    expect(context.gains.at(-1)!.connect).toHaveBeenCalledWith(context.gains[0]);
    transport.pause();
    const before = context.sources.length;
    transport.revealStar(0);
    transport.revealStar(1);
    expect(context.sources.length).toBe(before + 4);
    expect(context.sources[before + 2].frequency.calls[0].value).toBeGreaterThan(context.sources[before].frequency.calls[0].value);
    transport.dispose();
    expect(context.sources.every(s => s.stop.mock.calls.some(args => args.length === 0))).toBe(true);
  });
  it('plays live synthetic snare taps through the master despite muted backing', async () => {
    const { context, transport, score } = setup();
    const drum = score.parts[1];
    transport.setMix({ [drum.id]: { muted: true, solo: false } });
    await transport.play();
    transport.strike(drum.id, 38);
    const tap = context.sources.filter(s => s.buffer).at(-1)!;
    expect(tap.buffer).toBeDefined();
    expect(tap.frequency.calls).toHaveLength(0);
    expect(tap.stop.mock.calls[0][0] - tap.start.mock.calls[0][0]).toBeCloseTo(0.19);
    expect(context.gains.at(-1)!.connect).toHaveBeenCalledWith(context.gains[0]);
    transport.dispose();
    expect(tap.stop).toHaveBeenCalledWith();
  });
  it.each(['heart-of-oak', 'a-life-on-the-ocean-wave', 'the-captain-general'])(
    'routes the cymbal in %s to the recording and scales its damping time without stretching the sample', async id => {
      const score = fixture(id);
      const cymbal = score.parts.find(p => /cymbal/i.test(p.name))!;
      const timeline = interpretScore(score);
      const firstCrash = timeline.movements.find(m => m.partId === cymbal.id)!;
      const context = new FakeContext();
      const transport = new Transport(timeline, () => context as unknown as AudioContext);
      transport.seek(firstCrash.time);
      await transport.play();
      const crashes = () => context.sources.filter(s => (s.buffer as { numberOfChannels?: number } | undefined)?.numberOfChannels === 2);
      const crash = crashes()[0];
      expect(crash).toBeDefined();
      expect(crash.buffer).toBe(await context.decodeAudioData.mock.results[0].value);
      expect(crash.start).toHaveBeenCalledWith(0.035, 0.03);
      const release = 0.08 + 0.12 * firstCrash.velocity;
      expect(crash.stop.mock.calls[0][0] - crash.start.mock.calls[0][0]).toBeCloseTo(Math.min(10.97, firstCrash.seconds + release));
      const bus = context.gains[1 + score.parts.indexOf(cymbal)];
      const filter = crash.connect.mock.calls[0][0] as FakeNode;
      const crashGain = filter.connect.mock.calls[0][0] as FakeGain;
      expect(crashGain.connect).toHaveBeenCalledWith(bus);
      transport.setMix({ [cymbal.id]: { muted: true, solo: false } });
      expect(bus.gain.value).toBe(0);
      transport.setMix({ [cymbal.id]: { muted: false, solo: true, volume: 0.4 } });
      expect(bus.gain.value).toBe(0.4);
      expect(context.gains.filter(g => g !== bus && g !== context.gains[0]).slice(0, score.parts.length - 1).every(g => g.gain.value === 0)).toBe(true);
      transport.setSpeed(0.5);
      const slowed = crashes().at(-1)!;
      expect(slowed).not.toBe(crash);
      expect(crash.stop).toHaveBeenCalledWith();
      expect(slowed.buffer).toBe(crash.buffer);
      expect(slowed.start.mock.calls[0][1]).toBe(0.03);
      expect(slowed.stop.mock.calls[0][0] - slowed.start.mock.calls[0][0]).toBeCloseTo(Math.min(10.97, firstCrash.seconds * 2 + release));
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
      transport.pause();
      expect(crashes().every(source => source.stop.mock.calls.some(args => args.length === 0))).toBe(true);
      slowed.onended?.();
      expect(slowed.disconnect).toHaveBeenCalled();
      const slowedFilter = slowed.connect.mock.calls[0][0] as FakeNode;
      expect(slowedFilter.disconnect).toHaveBeenCalled();
      expect((slowedFilter.connect.mock.calls[0][0] as FakeGain).disconnect).toHaveBeenCalled();
      transport.dispose();
    },
  );
  it('waits for sample decoding before starting the clock and honours pause during loading', async () => {
    const timeline = interpretScore(fixture('heart-of-oak'));
    const context = new FakeContext();
    let resolve!: (buffer: ReturnType<FakeContext['createBuffer']>) => void;
    context.decodeAudioData.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const transport = new Transport(timeline, () => context as unknown as AudioContext);
    const started = transport.play();
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(1));
    expect(transport.getSnapshot().playing).toBe(false);
    expect(context.sources).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    transport.pause();
    resolve(context.createBuffer(2, 1100, 100));
    await started;
    expect(transport.getSnapshot().playing).toBe(false);
    expect(context.sources).toHaveLength(0);
    await transport.play();
    expect(transport.getSnapshot().playing).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    transport.dispose();
  });
  it.each(['download', 'decode'] as const)('reports a sample %s failure and allows Play to retry', async failure => {
    const context = new FakeContext();
    if (failure === 'download') vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    else context.decodeAudioData.mockRejectedValueOnce(new Error('Invalid audio'));
    const transport = new Transport(interpretScore(fixture('heart-of-oak')), () => context as unknown as AudioContext);
    await transport.play();
    expect(transport.getSnapshot()).toMatchObject({ playing: false, status: expect.stringContaining('Cymbal sample could not load') });
    expect(context.sources).toHaveLength(0);
    await transport.play();
    expect(transport.getSnapshot()).toMatchObject({ playing: true, status: undefined });
    expect(fetch).toHaveBeenCalledTimes(2);
    transport.dispose();
  });
  it('schedules four contacts per quaver with overlapping tails and cancels dry and wet output on pause', async () => {
    const score = parseScore(synthetic([
      measure(time() + tempo(120)),
      measure('<Sticking><text>R</text></Sticking>' + chord('quarter', 38, '<TremoloSingleChord><subtype>r16</subtype></TremoloSingleChord>')),
    ]), 'test');
    const timeline = interpretScore(score);
    const context = new FakeContext();
    const transport = new Transport(timeline, () => context as unknown as AudioContext);
    await transport.play();
    expect(timeline.movements.map(m => m.hand)).toEqual(['R', 'L', 'R', 'L']);
    expect(context.sources).toHaveLength(4);
    context.sources.filter(s => s.buffer).forEach((source, i) => {
      expect(source.buffer).toBeDefined();
      expect(source.start.mock.calls[0][0]).toBeCloseTo(0.035 + i * 0.0625);
    });
    expect(context.sources[0].stop.mock.calls[0][0]).toBeGreaterThan(context.sources[2].start.mock.calls[0][0]);
    context.currentTime = 0.135;
    vi.advanceTimersByTime(25);
    expect(context.sources).toHaveLength(8);
    transport.pause();
    expect(context.sources.every(s => s.stop.mock.calls.some(args => args.length === 0))).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(context.convolvers.every(node => node.disconnect.mock.calls.length > 0)).toBe(true);
    transport.dispose();
  });
  it('skips muted challenge sources while retaining live taps, count-in and audible accompaniment', async () => {
    const { context, transport, score } = setup();
    const part = score.parts[0];
    transport.setMix({ [part.id]: { muted: true, solo: false } });
    await transport.play({ countIn: true, skipMuted: true });
    expect(context.sources).toHaveLength(1); // Count-in remains audible.
    context.currentTime = 2.035;
    vi.advanceTimersByTime(25);
    expect(context.sources).toHaveLength(3); // Only the unmuted part is scheduled.
    transport.strike(part.id, 60);
    expect(context.sources).toHaveLength(4);
    expect(context.gains.at(-1)!.connect).toHaveBeenCalledWith(context.gains[0]);
    transport.dispose();
  });
  it('keeps muted practice sources available for immediate unmuting of held notes', async () => {
    const { context, transport, score } = setup();
    transport.setMix({ [score.parts[0].id]: { muted: true, solo: false } });
    await transport.play();
    expect(context.sources).toHaveLength(3);
    transport.setMix({ [score.parts[0].id]: { muted: false, solo: false } });
    expect(context.gains[1].gain.value).toBe(1);
    expect(context.sources).toHaveLength(3);
    transport.dispose();
  });
});
