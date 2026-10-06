import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Only this disposable directory is replaced. Original scores are never modified.
export async function prepareScores(root = fileURLToPath(new URL('../', import.meta.url))) {
  const source = path.join(root, 'scores');
  const output = path.join(root, 'public/generated');
  await mkdir(source, { recursive: true });
  const names = (await readdir(source)).filter(name => /\.mscz$/i.test(name)).sort();
  const ids = new Set();
  const manifest = [];
  const files = [];
  for (const filename of names) {
    const id = filename.replace(/\.mscz$/i, '');
    if (ids.has(id.toLowerCase())) throw new Error(`Duplicate score filename: ${filename}`);
    ids.add(id.toLowerCase());
    const bytes = await readFile(path.join(source, filename));
    const revision = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    const asset = `${revision}-${filename}`;
    manifest.push({ id, filename, url: `generated/scores/${encodeURIComponent(asset)}` });
    files.push({ asset, bytes });
  }
  await rm(output, { recursive: true, force: true });
  await mkdir(path.join(output, 'scores'), { recursive: true });
  for (const { asset, bytes } of files) await writeFile(path.join(output, 'scores', asset), bytes);
  await writeFile(path.join(output, 'catalogue.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await prepareScores();
  console.log(`Prepared ${manifest.length} scores from /scores.`);
}
