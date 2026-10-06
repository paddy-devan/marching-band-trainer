import { audioContacts } from '../score/interpret';
import type { Movement, Part, Timeline } from '../score/model';

export type Mix = Record<string, { muted: boolean; solo: boolean }>;
export type TransportState = { playing: boolean; position: number; speed: number; status?: string };
type Contact = { at: number; seconds: number; velocity: number; movement: Movement };
type SoundSource = AudioScheduledSourceNode;

export class Transport {
  private context?: AudioContext;
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
  private setup() {
    if (this.context) return;
    const context = this.createContext();
    this.context = context;
    const master = context.createGain();
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
  async play() {
    if (this.disposed || this.state.playing || this.starting) return;
    this.starting = true;
    const request = ++this.revision;
    try {
      this.setup();
      await this.context!.resume();
      if (request !== this.revision || this.disposed) return;
      if (this.context!.state !== 'running') throw new Error('Audio is suspended. Press Play again to resume.');
      const position = this.state.position >= this.timeline.duration ? 0 : this.state.position;
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
      bus.gain.setValueAtTime(audible ? 1 : 0, this.context!.currentTime);
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
    if (position >= this.timeline.duration) {
      this.cancel();
      this.notify({ playing: false, position: this.timeline.duration });
      return;
    }
    const horizon = position + 0.12 * this.state.speed;
    while (this.next < this.contacts.length && this.contacts[this.next].at < horizon) {
      const contact = this.contacts[this.next++];
      const when = this.anchorTime + (contact.at - this.anchorPosition) / this.state.speed;
      // A background-tab delay must not produce a burst of old attacks.
      if (when >= this.context.currentTime - 0.01) this.sound(contact, Math.max(when, this.context.currentTime));
    }
    this.notify({ position });
  }
  private track(source: SoundSource, nodes: AudioNode[]) {
    this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); nodes.forEach(n => n.disconnect()); };
  }
  private sound(contact: Contact, when: number) {
    const ctx = this.context!;
    const part = this.parts.get(contact.movement.partId)!;
    const bus = this.buses.get(part.id)!;
    const length = Math.max(0.02, Math.min(contact.seconds / this.state.speed, 2));
    const gain = ctx.createGain();
    gain.connect(bus);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(contact.velocity * (contact.movement.percussion ? 0.65 : 0.45), when + 0.003);
    const decay = contact.movement.percussion ? Math.min(length, 0.16) : length;
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
