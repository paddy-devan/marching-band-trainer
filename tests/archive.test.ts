import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { decodeArchive } from '../src/score/archive';

describe('archive discovery', () => {
  it('selects the master listed by the container, not the first excerpt', () => {
    const zip = zipSync({ 'excerpts/part.mscx': strToU8('excerpt'), 'arbitrary.mscx': strToU8('master'), 'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="arbitrary.mscx"/></rootfiles></container>') });
    expect(decodeArchive(zip)).toBe('master');
  });
  it('falls back to a single suitable score and rejects ambiguous or corrupt archives', () => {
    expect(decodeArchive(zipSync({ 'score.mscx': strToU8('score'), 'excerpts/part.mscx': strToU8('excerpt') }))).toBe('score');
    expect(() => decodeArchive(zipSync({ 'a.mscx': strToU8('a'), 'b.mscx': strToU8('b') }))).toThrow(/unique/);
    expect(() => decodeArchive(new Uint8Array([1, 2, 3]))).toThrow(/Cannot open/);
    expect(() => decodeArchive(zipSync({ 'META-INF/container.xml': strToU8('<container><rootfile full-path="missing.mscx"/></container>') }))).toThrow(/missing/);
  });
});
