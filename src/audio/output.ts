export function createMasterOutput(context: BaseAudioContext) {
  const master = context.createGain();
  master.gain.value = 2;
  const limiter = context.createWaveShaper();
  // Leave ordinary samples unchanged, then round peaks smoothly to +/-0.9.
  // WaveShaper holds the curve's endpoints for inputs beyond +/-1. The flat
  // slope at those endpoints avoids an abrupt corner when the mix overloads.
  const curve = new Float32Array(4097);
  for (let i = 0; i < curve.length; i++) {
    const input = i * 2 / (curve.length - 1) - 1;
    const excess = Math.max(0, Math.abs(input) - 0.8);
    curve[i] = input - Math.sign(input) * excess * excess / 0.4;
  }
  limiter.curve = curve;
  limiter.oversample = '4x';
  // The oversampling filter can ring past the limited peak. A final curve
  // without oversampling catches only those overshoots, with a 0.98 ceiling.
  const guard = context.createWaveShaper();
  const guardCurve = new Float32Array(4097);
  for (let i = 0; i < guardCurve.length; i++) {
    const input = i * 2 / (guardCurve.length - 1) - 1;
    const excess = Math.max(0, Math.abs(input) - 0.96);
    guardCurve[i] = input - Math.sign(input) * excess * excess / 0.08;
  }
  guard.curve = guardCurve;
  master.connect(limiter);
  limiter.connect(guard);
  guard.connect(context.destination);
  return master;
}
