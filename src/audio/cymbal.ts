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

  strike(when: number, velocity: number, output: AudioNode) {
    if (!this.crash) return;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, velocity)) * 0.8, when + 0.001);
    gain.connect(output);
    const source = this.context.createBufferSource();
    source.buffer = this.crash;
    source.connect(gain);
    this.track(source, [gain]);
    // Skip the lead-in even for live taps and the first beat; fade in to avoid a click.
    source.start(when, CRASH_OFFSET_SECONDS);
    // Preserve the recording's pitch and full tail at every playback speed.
    source.stop(when + this.crash.duration - CRASH_OFFSET_SECONDS);
  }
}
