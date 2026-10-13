import { audioContacts } from '../score/interpret';
import type { Movement, Part, Timeline } from '../score/model';
import { countIn, metronomeClicks, type Click } from './beats';

export type Mix = Record<string, { muted: boolean; solo: boolean; volume?: number }>;
export type TransportState = { playing: boolean; position: number; speed: number; status?: string };
export type PlayOptions = { countIn?: boolean; metronome?: boolean; outputTiming?: boolean };
type Contact = { at: number; seconds: number; velocity: number; movement: Movement };
type SoundSource = AudioScheduledSourceNode;

export class Transport {
  private context?: AudioContext;
  private master?: GainNode;
  private buses = new Map<string, GainNode>();
  private sources = new Set<SoundSource>();
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
  private state: TransportState = { playing: false, position: 0, speed: 1 };
  private noise?: AudioBuffer;
  private parts: Map<string, Part>;
  private clicks: Click[] = [];
  private nextClick = 0;
  private outputTiming = false;

  constructor(readonly timeline: Timeline, private createContext = () => new AudioContext()) {
    this.parts = new Map(timeline.score.parts.map(p => [p.id, p]));
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
    const output = ctx.getOutputTimestamp?.();
    const now = performance.now();
    const audioTime = output && typeof output.contextTime === 'number' && typeof output.performanceTime === 'number' && output.contextTime > 0 && Math.abs(now - output.performanceTime) < 1000
      ? output.contextTime + (timestamp - output.performanceTime) / 1000
      : ctx.currentTime + (timestamp - now) / 1000 - (ctx.baseLatency || 0) - (ctx.outputLatency || 0);
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
  }
  async play(options: PlayOptions = {}) {
    if (this.disposed || this.state.playing || this.starting) return;
    this.starting = true;
    const request = ++this.revision;
    try {
      this.setup();
      await this.context!.resume();
      if (request !== this.revision || this.disposed) return;
      if (this.context!.state !== 'running') throw new Error('Audio is suspended. Press Play again to resume.');
      this.outputTiming = options.outputTiming ?? false;
      const leadIn = options.countIn ? countIn(this.timeline) : undefined;
      this.clicks = options.metronome ? metronomeClicks(this.timeline) : [];
      if (leadIn) this.clicks.unshift(...Array.from({ length: leadIn.beats }, (_, beat) => ({ time: -leadIn.duration + beat * leadIn.interval, accent: beat === 0 })));
      const position = leadIn ? -leadIn.duration : this.state.position >= this.timeline.duration ? 0 : this.state.position;
      this.notify({ playing: true, position, status: undefined });
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
  }
  private reanchor(position: number) {
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
      const when = this.anchorTime + (click.time - this.anchorPosition) / this.state.speed;
      if (when >= this.context.currentTime - 0.01) this.tone(click.accent ? 1400 : 1000, Math.max(when, this.context.currentTime), 0.045, 0.3);
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
      time: 0, seconds: 0.35 * this.state.speed, pitch: soundingPitch - part.register.transpose,
      percussion: false, provenance: 'unknown', roll: false, velocity: 0.8, sourceIds: [], sourceId: 'tap',
    };
    this.sound({ at: 0, seconds: movement.seconds, velocity: movement.velocity, movement }, this.context.currentTime, this.master);
  }
  private track(source: SoundSource, nodes: AudioNode[]) {
    this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); nodes.forEach(n => n.disconnect()); };
  }
  private sound(contact: Contact, when: number, output?: GainNode) {
    const ctx = this.context!;
    const part = this.parts.get(contact.movement.partId)!;
    const bus = this.buses.get(part.id)!;
    const length = Math.max(0.02, Math.min(contact.seconds / this.state.speed, 2));
    const gain = ctx.createGain();
    gain.connect(output || bus);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(contact.velocity * (contact.movement.percussion ? 0.65 : 0.45), when + 0.003);
    const lyre = part.renderer === 'lyre' && !contact.movement.percussion;
    const decay = contact.movement.percussion ? Math.min(length, 0.16) : lyre ? Math.min(2.5, length * 1.2 + 0.06) : length;
    if (lyre) gain.gain.exponentialRampToValueAtTime(contact.velocity * 0.055, when + Math.min(0.3, length * 0.5));
    gain.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    if (!contact.movement.percussion || /bass/i.test(part.name + part.instrument)) {
      const osc = ctx.createOscillator();
      osc.type = contact.movement.percussion ? 'sine' : 'triangle';
      const frequency = contact.movement.percussion ? 95 : 440 * 2 ** ((contact.movement.pitch + part.register.transpose - 69) / 12);
      osc.frequency.setValueAtTime(frequency, when);
      if (contact.movement.percussion) osc.frequency.exponentialRampToValueAtTime(45, when + decay);
      osc.connect(gain);
      this.track(osc, [gain]);
      osc.start(when);
      osc.stop(when + decay + 0.01);
    } else {
      if (!this.noise) {
        this.noise = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = this.noise;
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass'; filter.frequency.value = 1200;
      noise.connect(filter); filter.connect(gain);
      this.track(noise, [filter, gain]);
      noise.start(when);
      noise.stop(when + decay + 0.01);
    }
  }
  dispose() {
    this.pause();
    this.disposed = true;
    this.listeners.clear();
    void this.context?.close();
  }
}
