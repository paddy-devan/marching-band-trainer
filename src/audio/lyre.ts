type Track = (source: AudioScheduledSourceNode, nodes: AudioNode[]) => void;

// A struck metal bar rings at inharmonic frequencies rather than the odd
// harmonics of a triangle wave. Keep the upper modes brief and softly voiced.
const MODES = [
  { ratio: 1, level: 1, decay: 1 },
  { ratio: 2.756, level: 0.31, decay: 0.46 },
  { ratio: 5.404, level: 0.095, decay: 0.2 },
  { ratio: 8.933, level: 0.024, decay: 0.09 },
];

export class LyreSynth {
  constructor(private context: BaseAudioContext, private track: Track) {}

  strike(when: number, pitch: number, velocity: number, output: AudioNode, length?: number) {
    const ctx = this.context;
    const fundamental = 440 * 2 ** ((pitch - 69) / 12);
    const naturalDecay = Math.max(1.15, Math.min(2.5, 2.1 * (1046.502 / fundamental) ** 0.3));
    // Written lengths gently damp the ring; free taps get the full bar decay.
    const ring = length === undefined ? naturalDecay : Math.min(naturalDecay, Math.max(0.65, length + 0.45));
    const strength = Math.max(0, Math.min(1, velocity));
    if (!strength) return;
    for (const mode of MODES) {
      const frequency = fundamental * mode.ratio;
      // Omit inaudible modes rather than folding them into the audible range.
      if (frequency >= Math.min(14000, ctx.sampleRate * 0.45)) continue;
      const warmth = mode.ratio === 1 ? 1 : 1 / (1 + (frequency / 6500) ** 2);
      const peak = strength * 0.44 * mode.level * warmth;
      const duration = ring * mode.decay;
      const gain = ctx.createGain();
      gain.connect(output);
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(peak, when + 0.0025);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.000001, peak * 0.0005), when + duration - 0.008);
      gain.gain.linearRampToValueAtTime(0, when + duration);
      const oscillator = ctx.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, when);
      oscillator.connect(gain);
      this.track(oscillator, [gain]);
      oscillator.start(when);
      oscillator.stop(when + duration);
    }
  }
}
