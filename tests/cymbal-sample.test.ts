import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import sampleUrl from '../samples/marching-hand-cymbal.wav?url';

it('ships PCM cymbal audio with no codec priming and a beat-aligned crash after the contact lead-in', () => {
  const sample = readFileSync(path.join(process.cwd(), sampleUrl));
  expect(sample.toString('ascii', 0, 4)).toBe('RIFF');
  expect(sample.toString('ascii', 8, 12)).toBe('WAVE');
  const chunks = new Map<string, Buffer>();
  for (let offset = 12; offset + 8 <= sample.length;) {
    const size = sample.readUInt32LE(offset + 4);
    chunks.set(sample.toString('ascii', offset, offset + 4), sample.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size + size % 2;
  }
  const format = chunks.get('fmt ')!;
  expect(format.readUInt16LE(0)).toBe(1); // Uncompressed PCM, with no encoder delay.
  expect(format.readUInt16LE(2)).toBe(2);
  expect(format.readUInt32LE(4)).toBe(44100);
  expect(format.readUInt16LE(14)).toBe(16);
  const audio = chunks.get('data')!;
  expect(audio.length / 4 / 44100).toBeGreaterThan(10); // Preserve the recorded tail.
  let crash = -1;
  for (let offset = 0; offset < audio.length; offset += 2) {
    if (Math.abs(audio.readInt16LE(offset)) > 0.3 * 32768) { crash = Math.floor(offset / 4) / 44100; break; }
  }
  expect(crash - 0.03).toBeGreaterThanOrEqual(0);
  expect(crash - 0.03).toBeLessThan(0.01);
});
