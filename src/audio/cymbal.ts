import sampleUrl from '../../samples/marching-hand-cymbal.m4a?url';

// The recording has quiet contact noise before the main crash at roughly 30 ms.
const CRASH_OFFSET_SECONDS = 0.03;

type Track = (source: AudioScheduledSourceNode, nodes: AudioNode[]) => void;

export class CymbalSample {
  private crash?: AudioBuffer;
  private loading?: Promise<void>;

  constructor(private context: BaseAudioContext, private track: Track) {}

  load() {
    if (!this.loading) {
      this.loading = (async () => {
        const response = await fetch(sampleUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        this.crash = await this.context.decodeAudioData(await response.arrayBuffer());
      })().catch(error => {
        this.loading = undefined;
        throw new Error('Cymbal sample could not load. Press Play to try again.', { cause: error });
      });
    }
    return this.loading;
  }

  strike(when: number, velocity: number, output: AudioNode, seconds?: number) {
    if (!this.crash || velocity <= 0) return;
    const strength = Math.max(0, Math.min(1, velocity));
    const peak = strength ** 1.5 * 0.8;
    const tail = this.crash.duration - CRASH_OFFSET_SECONDS;
    // A light contact has less high-frequency energy than a full crash. Keep
    // the original attack timing and pitch; no resampling or extra recordings.
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = Math.SQRT1_2;
    filter.frequency.setValueAtTime(Math.min(this.context.sampleRate * 0.45, 2500 + 17500 * strength ** 2), when);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.001);
    let stop = tail;
    if (seconds !== undefined) {
      // Tied notes arrive as a single event with their combined duration.
      // Allow a brief release past the written end to approximate hand damping.
      const releaseAt = Math.max(0.001, seconds);
      const release = 0.08 + 0.12 * strength;
      if (releaseAt + release < tail) {
        gain.gain.setValueAtTime(peak, when + releaseAt);
        gain.gain.exponentialRampToValueAtTime(Math.min(0.00001, peak), when + releaseAt + release * 0.8);
        gain.gain.linearRampToValueAtTime(0, when + releaseAt + release);
        stop = releaseAt + release;
      }
    }
    filter.connect(gain);
    gain.connect(output);
    const source = this.context.createBufferSource();
    source.buffer = this.crash;
    source.connect(filter);
    this.track(source, [filter, gain]);
    // Skip the lead-in even for live taps and the first beat; fade in to avoid a click.
    source.start(when, CRASH_OFFSET_SECONDS);
    // Unmeasured live taps retain the full recorded decay.
    source.stop(when + stop);
  }
}
