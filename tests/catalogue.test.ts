import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ScoreMetadata } from '../src/score/model';
// @ts-expect-error Node-only JavaScript preparation script.
import { prepareScores } from '../scripts/prepare-scores.mjs';

it('automatically reflects score additions, revisions and removals', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'band-catalogue-'));
  try {
    await mkdir(path.join(root, 'scores'));
    await writeFile(path.join(root, 'scores', 'one.mscz'), 'original');
    let entries = await prepareScores(root);
    const firstUrl = entries[0].url;
    expect(await readFile(path.join(root, 'public', decodeURIComponent(firstUrl)), 'utf8')).toBe('original');
    await writeFile(path.join(root, 'scores', 'one.mscz'), 'changed');
    await writeFile(path.join(root, 'scores', 'second score.mscz'), 'second');
    entries = await prepareScores(root);
    expect(entries).toHaveLength(2);
    expect(entries[0].url).not.toBe(firstUrl);
    expect(entries[1].url).toContain('%20');
    await rm(path.join(root, 'scores', 'one.mscz'));
    entries = await prepareScores(root);
    expect(entries.map((e: { id: string }) => e.id)).toEqual(['second score']);
    expect(await readdir(path.join(root, 'public/generated/scores'))).toHaveLength(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('merges optional metadata and republishes description edits without changing the score asset', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'band-metadata-'));
  try {
    await mkdir(path.join(root, 'scores'));
    await writeFile(path.join(root, 'scores', 'one.mscz'), 'original');
    await writeFile(path.join(root, 'scores', 'two.mscz'), 'second');
    const metadata = { one: { type: 'drum-solo', description: 'A drum routine.', sources: ['https://example.com/history'] } };
    const metadataPath = path.join(root, 'scores.metadata.json');
    await writeFile(metadataPath, JSON.stringify(metadata));
    let entries = await prepareScores(root);
    expect(entries[0]).toMatchObject(metadata.one);
    expect(entries[1].type).toBeUndefined();
    const firstUrl = entries[0].url;
    metadata.one.description = 'An updated description.';
    await writeFile(metadataPath, JSON.stringify(metadata));
    entries = await prepareScores(root);
    expect(entries[0].url).toBe(firstUrl);
    expect(entries[0].description).toBe('An updated description.');
    expect(JSON.parse(await readFile(path.join(root, 'public/generated/catalogue.json'), 'utf8'))).toEqual(entries);
    expect(JSON.parse(await readFile(metadataPath, 'utf8'))).toEqual(metadata);
    expect(await readFile(path.join(root, 'scores', 'one.mscz'), 'utf8')).toBe('original');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it.each([
  [[], 'must be an object'],
  [{ missing: { type: 'full-band', description: 'A march.' } }, 'Unknown score'],
  [{ one: { type: 'solo', description: 'A routine.' } }, 'Invalid type'],
  [{ one: { type: 'drum-solo', description: 42 } }, 'Description'],
  [{ one: { type: 'drum-solo', description: 'A routine.', sources: ['not a URL'] } }, 'Sources'],
  [{ one: { type: 'drum-solo', description: 'A routine.', source: 'https://example.com' } }, 'Unknown metadata field'],
])('rejects invalid metadata without deleting the published catalogue (%j)', async (metadata, message) => {
  const root = await mkdtemp(path.join(tmpdir(), 'band-invalid-metadata-'));
  try {
    await mkdir(path.join(root, 'scores'));
    await writeFile(path.join(root, 'scores', 'one.mscz'), 'original');
    await prepareScores(root);
    const cataloguePath = path.join(root, 'public/generated/catalogue.json');
    const original = await readFile(cataloguePath, 'utf8');
    await writeFile(path.join(root, 'scores.metadata.json'), JSON.stringify(metadata));
    await expect(prepareScores(root)).rejects.toThrow(message);
    expect(await readFile(cataloguePath, 'utf8')).toBe(original);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('keeps maintained descriptions concise and metadata keys matched to current pieces', async () => {
  const metadata: Record<string, ScoreMetadata> = JSON.parse(await readFile('scores.metadata.json', 'utf8'));
  const ids = (await readdir('scores')).filter(name => /\.mscz$/i.test(name)).map(name => name.replace(/\.mscz$/i, ''));
  expect(Object.keys(metadata).length).toBeGreaterThan(0);
  for (const [id, entry] of Object.entries(metadata)) {
    expect(ids).toContain(id);
    expect(['drum-solo', 'full-band']).toContain(entry.type);
    expect(entry.description.trim()).not.toBe('');
    expect(entry.description.match(/[.!?](?:\s|$)/g)?.length).toBeLessThanOrEqual(2);
  }
});
