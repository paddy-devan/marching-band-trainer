type Track = (source: AudioScheduledSourceNode, nodes: AudioNode[]) => void;

// Entirely procedural: filtered noise for the wires, a pitched membrane, and a
// short generated room response. Neither buffer contains a recorded instrument.
export class SnareSynth {
  private noise: AudioBuffer;
  private room: AudioBuffer;
  private rooms = new Map<AudioNode, { convolver: ConvolverNode; wet: GainNode }>();
  private strikeIndex = 0;

  constructor(private context: BaseAudioContext, private track: Track) {
    this.noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const noise = this.noise.getChannelData(0);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1;
    this.room = context.createBuffer(2, Math.ceil(context.sampleRate * 0.22), context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = this.room.getChannelData(channel);
      for (let i = 0; i < data.length; i++) {
        const time = i / context.sampleRate;
        // Leave the direct attack clear; only the tail gets this faint space.
        data[i] = time < 0.012 ? 0 : (Math.random() * 2 - 1) * (1 - time / 0.22) ** 3;
      }
    }
  }

  strike(when: number, velocity: number, output: AudioNode) {
    const ctx = this.context;
    const gain = ctx.createGain();
    gain.connect(output);
    let room = this.rooms.get(output);
    if (!room) {
      const convolver = ctx.createConvolver();
      convolver.buffer = this.room;
      const wet = ctx.createGain();
      wet.gain.value = 0.08;
      convolver.connect(wet); wet.connect(output);
      room = { convolver, wet };
      this.rooms.set(output, room);
    }
    gain.connect(room.convolver);
    // A crisp attack followed by a quieter rattle, independent of the next
    // strike or playback speed. Overlapping voices preserve attack definition.
    const peak = Math.max(0.0002, velocity * 0.65);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.0015);
    gain.gain.exponentialRampToValueAtTime(peak * 0.22, when + 0.022);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise;
    noise.loop = true;
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass'; highpass.frequency.value = 750;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass'; lowpass.frequency.value = 8000;
    noise.connect(highpass); highpass.connect(lowpass); lowpass.connect(gain);
    this.track(noise, [highpass, lowpass, gain]);
    // Avoid repeating the identical noise waveform on every contact, without
    // introducing timing jitter, pitch changes, or hand-dependent accents.
    noise.start(when, (++this.strikeIndex * 0.61803398875) % 1);
    noise.stop(when + 0.19);

    const bodyGain = ctx.createGain();
    bodyGain.connect(output); bodyGain.connect(room.convolver);
    bodyGain.gain.setValueAtTime(0.0001, when);
    bodyGain.gain.linearRampToValueAtTime(Math.max(0.0002, velocity * 0.22), when + 0.001);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.065);
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(230, when);
    body.frequency.exponentialRampToValueAtTime(180, when + 0.025);
    body.connect(bodyGain);
    this.track(body, [bodyGain]);
    body.start(when); body.stop(when + 0.075);
  }

  clearReverb() {
    // Disconnect stored energy immediately on pause, seek or speed change.
    // Routing effects before the part bus also makes mute/solo immediate.
    for (const { convolver, wet } of this.rooms.values()) {
      convolver.disconnect(); wet.disconnect();
    }
    this.rooms.clear();
  }
}
