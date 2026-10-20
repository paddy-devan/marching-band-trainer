import { audioContacts } from '../score/interpret';
import type { Movement, Part, Timeline } from '../score/model';
import { countIn, metronomeClicks, type Click } from './beats';
import { SnareSynth } from './snare';
import { CymbalSample } from './cymbal';
import { LyreSynth } from './lyre';

export type Mix = Record<string, { muted: boolean; solo: boolean; volume?: number }>;
export type TransportState = { playing: boolean; position: number; speed: number; metronome: boolean; status?: string };
export type PlayOptions = { countIn?: boolean; metronome?: boolean; outputTiming?: boolean; skipMuted?: boolean };
type Contact = { at: number; seconds: number; velocity: number; movement: Movement };
type SoundSource = AudioScheduledSourceNode;

// Device reports can be invalid on Firefox Android. Allow even slow wireless
// output, but never let an unbounded/negative delay freeze the challenge clock.
const MAX_OUTPUT_DELAY = 2;
// Apply after score velocity clamping so accents remain distinct at louder dynamics.
const DRUM_ACCENT_GAIN = 1.6;
function deviceLatency(delay: number | undefined) {
  return typeof delay === 'number' && Number.isFinite(delay) && delay >= 0 && delay <= MAX_OUTPUT_DELAY ? delay : 0;
}

export class Transport {
  private context?: AudioContext;
  private master?: GainNode;
  private buses = new Map<string, GainNode>();
  private sources = new Set<SoundSource>();
  private metronomeSources = new Set<SoundSource>();
  private listeners = new Set<() => void>();
  private mix: Mix = {};
  private contacts: Contact[];
  private next = 0;
  private timer?: ReturnType<typeof setInterval>;
  private anchorTime = 0;
  private anchorPosition = 0;
  private starting = false;
  private revision = 0;
  private disposed = false;
  private state: TransportState = { playing: false, position: 0, speed: 1, metronome: false };
  private snare?: SnareSynth;
  private cymbal?: CymbalSample;
  private lyre?: LyreSynth;
  private parts: Map<string, Part>;
  private clicks: Click[] = [];
  private nextClick = 0;
  private outputTiming = false;
  private skipMuted = false;
  private bassParts: Set<string>;
  private cymbalParts: Set<string>;

  constructor(readonly timeline: Timeline, private createContext = () => new AudioContext()) {
    this.parts = new Map(timeline.score.parts.map(p => [p.id, p]));
    this.bassParts = new Set(timeline.score.parts.filter(p => /bass/i.test(p.name + p.instrument)).map(p => p.id));
    this.cymbalParts = new Set(timeline.score.parts.filter(p => /cymbal/i.test(p.name + p.instrument)).map(p => p.id));
    this.contacts = timeline.movements.flatMap(movement => audioContacts(movement).map(c => ({ at: c.time, seconds: c.seconds, velocity: c.velocity, movement }))).sort((a, b) => a.at - b.at);
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private notify(change: Partial<TransportState>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach(l => l());
  }
  private position() {
    if (!this.state.playing || !this.context) return this.state.position;
    return Math.min(this.timeline.duration, this.anchorPosition + Math.max(0, this.context.currentTime - this.anchorTime) * this.state.speed);
  }
  // Input events and animation frames use the same audible clock. Snapshots are
  // deliberately throttled and must not be used to judge a rhythmic strike.
  readPosition(timestamp = performance.now()) {
    const ctx = this.context;
    if (!this.state.playing || !ctx) return this.state.position;
    const now = performance.now();
    const renderTime = ctx.currentTime;
    let audibleTime = renderTime - deviceLatency(ctx.baseLatency) - deviceLatency(ctx.outputLatency);
    try {
      const output = ctx.getOutputTimestamp?.();
      if (output && typeof output.contextTime === 'number' && typeof output.performanceTime === 'number'
        && Number.isFinite(output.contextTime) && Number.isFinite(output.performanceTime)
        && output.contextTime > 0 && Math.abs(now - output.performanceTime) < 1000) {
        const outputNow = output.contextTime + (now - output.performanceTime) / 1000;
        if (outputNow <= renderTime + 0.05 && outputNow >= renderTime - MAX_OUTPUT_DELAY) audibleTime = outputNow;
      }
    } catch { /* Some devices expose the API but cannot provide an output timestamp. */ }
    const audioTime = audibleTime + (timestamp - now) / 1000;
    return Math.min(this.timeline.duration, this.anchorPosition + Math.max(0, audioTime - this.anchorTime) * this.state.speed);
  }
  private setup() {
    if (this.context) return;
    const context = this.createContext();
    this.context = context;
    const master = context.createGain();
    this.master = master;
    master.gain.value = 0.2;
    master.connect(context.destination);
    for (const p of this.parts.values()) {
      const bus = context.createGain();
      bus.connect(master);
      this.buses.set(p.id, bus);
    }
    context.addEventListener('statechange', () => {
      if (this.state.playing && context.state !== 'running') {
        this.pause();
        this.notify({ status: 'Audio paused by your device. Press Play to resume.' });
      }
    });
    this.updateGains();
    this.lyre = new LyreSynth(context, (source, nodes) => this.track(source, nodes));
    // Prepare procedural noise/room buffers before the first live strike.
    if ([...this.parts.values()].some(p => p.percussion && !this.bassParts.has(p.id) && !this.cymbalParts.has(p.id)))
      this.snare = new SnareSynth(context, (source, nodes) => this.track(source, nodes));
    if ([...this.parts.values()].some(p => p.percussion && this.cymbalParts.has(p.id)))
      this.cymbal = new CymbalSample(context, (source, nodes) => this.track(source, nodes));
  }
  async play(options: PlayOptions = {}) {
    if (this.disposed || this.state.playing || this.starting) return;
    this.starting = true;
    const request = ++this.revision;
    try {
      this.setup();
      await this.context!.resume();
      if (request !== this.revision || this.disposed) return;
      // Resume within the user gesture, then load before anchoring the clock.
      if (this.cymbal) await this.cymbal.load();
      if (request !== this.revision || this.disposed) return;
      if (this.context!.state !== 'running') throw new Error('Audio is suspended. Press Play again to resume.');
      this.outputTiming = options.outputTiming ?? false;
      // Challenge mixes are fixed until Stop. Practice keeps muted sources so
      // unmuting a held or already-scheduled note still works immediately.
      this.skipMuted = options.skipMuted ?? false;
      const leadIn = options.countIn ? countIn(this.timeline) : undefined;
      this.clicks = metronomeClicks(this.timeline);
      if (leadIn) this.clicks.unshift(...Array.from({ length: leadIn.beats }, (_, beat) => ({ time: -leadIn.duration + beat * leadIn.interval, accent: beat === 0 })));
      const position = leadIn ? -leadIn.duration : this.state.position >= this.timeline.duration ? 0 : this.state.position;
      this.notify({ playing: true, position, metronome: options.metronome ?? this.state.metronome, status: undefined });
      this.reanchor(position);
    } catch (error) {
      if (request === this.revision && !this.disposed) this.notify({ playing: false, status: error instanceof Error ? error.message : 'Audio could not start.' });
    } finally { if (request === this.revision) this.starting = false; }
  }
  pause() {
    const position = this.position();
    ++this.revision;
    this.starting = false;
    this.cancel();
    this.notify({ playing: false, position });
  }
  seek(position: number) {
    if (!Number.isFinite(position)) return;
    position = Math.max(0, Math.min(position, this.timeline.duration));
    const wasPlaying = this.state.playing;
    ++this.revision;
    this.starting = false;
    this.cancel();
    this.notify({ position, playing: wasPlaying && position < this.timeline.duration, status: undefined });
    if (this.state.playing) this.reanchor(position);
  }
  restart() { this.seek(0); }
  setSpeed(speed: number) {
    if (!Number.isFinite(speed)) return;
    const position = this.position();
    this.cancel();
    this.notify({ position, speed: Math.min(1.5, Math.max(0.25, speed)) });
    if (this.state.playing) this.reanchor(position);
  }
  setMix(mix: Mix) { this.mix = mix; this.updateGains(); }
  setMetronome(enabled: boolean) {
    if (enabled === this.state.metronome) return;
    // Cancel only click voices: switching the click never interrupts a held
    // instrument note or changes the playback anchor.
    for (const source of this.metronomeSources) {
      try { source.stop(); } catch { /* Already ended. */ }
      source.disconnect();
      this.sources.delete(source);
    }
    this.metronomeSources.clear();
    this.notify({ metronome: enabled });
    const position = this.position();
    if (enabled && this.state.playing && position >= 0) {
      this.nextClick = this.clicks.findIndex(c => c.time >= position - 1e-8);
      if (this.nextClick < 0) this.nextClick = this.clicks.length;
      this.tick();
    }
  }
  private updateGains() {
    const solo = Object.values(this.mix).some(m => m.solo);
    for (const [id, bus] of this.buses) {
      const part = this.mix[id];
      const audible = !part?.muted && (!solo || part?.solo);
      bus.gain.setValueAtTime(audible ? Math.max(0, Math.min(1, part?.volume ?? 1)) : 0, this.context!.currentTime);
    }
  }
  private cancel() {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    for (const source of this.sources) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
    this.sources.clear();
    this.metronomeSources.clear();
    this.snare?.clearReverb();
  }
  private reanchor(position: number) {
    // Give an opening flam its pre-beat stroke, including on restart. Other
    // seeks still omit attacks before the requested point.
    if (position === 0 && this.contacts[0]?.at < 0) position = this.contacts[0].at;
    this.anchorPosition = position;
    this.anchorTime = this.context!.currentTime + 0.035;
    this.next = this.contacts.findIndex(c => c.at >= position - 1e-8);
    if (this.next < 0) this.next = this.contacts.length;
    this.nextClick = this.clicks.findIndex(c => c.time >= position - 1e-8);
    if (this.nextClick < 0) this.nextClick = this.clicks.length;
    // Restore a held pitched note when resuming or seeking into its duration.
    for (const movement of this.timeline.movements) {
      if (!movement.percussion && movement.time < position - 1e-8 && movement.time + movement.seconds > position) {
        this.sound({ at: position, seconds: movement.time + movement.seconds - position, velocity: movement.velocity, movement }, this.anchorTime);
      }
    }
    this.tick();
    this.timer = setInterval(() => this.tick(), 25);
  }
  private tick() {
    if (!this.state.playing || !this.context) return;
    const position = this.position();
    if (position >= this.timeline.duration && (!this.outputTiming || this.readPosition() >= this.timeline.duration)) {
      this.cancel();
      this.notify({ playing: false, position: this.timeline.duration });
      return;
    }
    const horizon = position + 0.12 * this.state.speed;
    while (this.nextClick < this.clicks.length && this.clicks[this.nextClick].time < horizon) {
      const click = this.clicks[this.nextClick++];
      if (click.time >= 0 && !this.state.metronome) continue;
      const when = this.anchorTime + (click.time - this.anchorPosition) / this.state.speed;
      if (when >= this.context.currentTime - 0.01) {
        const source = this.tone(click.accent ? 1400 : 1000, Math.max(when, this.context.currentTime), 0.045, 0.3);
        if (click.time >= 0) this.metronomeSources.add(source);
      }
    }
    while (this.next < this.contacts.length && this.contacts[this.next].at < horizon) {
      const contact = this.contacts[this.next++];
      const when = this.anchorTime + (contact.at - this.anchorPosition) / this.state.speed;
      // A background-tab delay must not produce a burst of old attacks.
      if (when >= this.context.currentTime - 0.01) this.sound(contact, Math.max(when, this.context.currentTime));
    }
    this.notify({ position: this.outputTiming ? this.readPosition() : position });
  }
  private tone(frequency: number, when: number, duration: number, volume: number) {
    const ctx = this.context!;
    const gain = ctx.createGain();
    gain.connect(this.master!);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(volume, when + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, when);
    oscillator.connect(gain);
    this.track(oscillator, [gain]);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.01);
    return oscillator;
  }
  revealStar(index: number) {
    if (!this.context || this.context.state !== 'running' || this.disposed) return;
    const when = this.context.currentTime + 0.005;
    const melody = [72, 74, 76, 79, 81, 84, 86, 88, 91, 96];
    const pitch = melody[Math.min(9, Math.max(0, index))];
    this.tone(440 * 2 ** ((pitch - 69) / 12), when, 0.23, 0.4);
    this.tone(440 * 2 ** ((pitch + 12 - 69) / 12), when + 0.025, 0.14, 0.1);
  }
  strike(partId: string, soundingPitch: number) {
    const part = this.parts.get(partId);
    if (!part || !this.context || this.context.state !== 'running' || this.disposed) return;
    const movement: Movement = {
      id: 'tap', partId, position: { n: 0, d: 1 }, duration: { n: 1, d: 1 },
      time: 0, seconds: 0.35 * this.state.speed, pitch: part.percussion ? soundingPitch : soundingPitch - part.register.transpose,
      percussion: part.percussion, provenance: 'unknown', roll: false, velocity: 0.8, sourceIds: [], sourceId: 'tap',
    };
    this.sound({ at: 0, seconds: movement.seconds, velocity: movement.velocity, movement }, this.context.currentTime, this.master);
  }
  private track(source: SoundSource, nodes: AudioNode[]) {
    this.sources.add(source);
    source.onended = () => { this.sources.delete(source); this.metronomeSources.delete(source); source.disconnect(); nodes.forEach(n => n.disconnect()); };
  }
  private sound(contact: Contact, when: number, output?: GainNode) {
    const ctx = this.context!;
    const part = this.parts.get(contact.movement.partId)!;
    const bus = this.buses.get(part.id)!;
    if (this.skipMuted && !output && bus.gain.value === 0) return;
    if (contact.movement.percussion && this.cymbalParts.has(part.id)) {
      this.cymbal!.strike(when, contact.velocity, output || bus, output ? undefined : contact.seconds / this.state.speed);
      return;
    }
    const velocity = contact.velocity * (contact.movement.percussion && contact.movement.accent ? DRUM_ACCENT_GAIN : 1);
    if (contact.movement.percussion && !this.bassParts.has(part.id)) {
      this.snare!.strike(when, velocity, output || bus);
      return;
    }
    if (part.renderer === 'lyre' && !contact.movement.percussion) {
      this.lyre!.strike(when, contact.movement.pitch + part.register.transpose, contact.velocity, output || bus,
        output ? undefined : contact.seconds / this.state.speed);
      return;
    }
    const length = Math.max(0.02, Math.min(contact.seconds / this.state.speed, 2));
    const gain = ctx.createGain();
    gain.connect(output || bus);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(velocity * (contact.movement.percussion ? 0.65 : 0.45), when + 0.003);
    const decay = contact.movement.percussion ? Math.min(length, 0.16) : length;
    gain.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    const osc = ctx.createOscillator();
    osc.type = contact.movement.percussion ? 'sine' : 'triangle';
    const frequency = contact.movement.percussion ? 95 : 440 * 2 ** ((contact.movement.pitch + part.register.transpose - 69) / 12);
    osc.frequency.setValueAtTime(frequency, when);
    if (contact.movement.percussion) osc.frequency.exponentialRampToValueAtTime(45, when + decay);
    osc.connect(gain);
    this.track(osc, [gain]);
    osc.start(when);
    osc.stop(when + decay + 0.01);
  }
  dispose() {
    this.pause();
    this.disposed = true;
    this.listeners.clear();
    void this.context?.close();
  }
}
