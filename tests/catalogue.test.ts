import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
