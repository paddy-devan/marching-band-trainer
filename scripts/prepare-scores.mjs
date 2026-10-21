import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

async function readMetadata(root, names) {
  let metadata;
  try {
    metadata = JSON.parse(await readFile(path.join(root, 'scores.metadata.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Cannot read scores.metadata.json: ${error.message}`);
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    throw new Error('scores.metadata.json must be an object keyed by score filename without .mscz.');
  const scoreIds = new Set(names.map(name => name.replace(/\.mscz$/i, '')));
  for (const [id, entry] of Object.entries(metadata)) {
    if (!scoreIds.has(id)) throw new Error(`Unknown score in scores.metadata.json: ${id}. Use the exact filename without .mscz.`);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Invalid metadata for ${id}.`);
    for (const field of Object.keys(entry)) {
      if (!['type', 'description', 'sources'].includes(field)) throw new Error(`Unknown metadata field for ${id}: ${field}.`);
    }
    if (!['drum-solo', 'full-band'].includes(entry.type)) throw new Error(`Invalid type for ${id}: use drum-solo or full-band.`);
    if (typeof entry.description !== 'string' || !entry.description.trim()) throw new Error(`Description for ${id} must be a non-empty string.`);
    if (entry.sources !== undefined && (!Array.isArray(entry.sources) || entry.sources.some(source => {
      try { return typeof source !== 'string' || !['http:', 'https:'].includes(new URL(source).protocol); }
      catch { return true; }
    }))) throw new Error(`Sources for ${id} must be an array of HTTP or HTTPS URLs.`);
  }
  return metadata;
}

// Only this disposable directory is replaced. Original scores are never modified.
export async function prepareScores(root = fileURLToPath(new URL('../', import.meta.url))) {
  const source = path.join(root, 'scores');
  const output = path.join(root, 'public/generated');
  await mkdir(source, { recursive: true });
  const names = (await readdir(source)).filter(name => /\.mscz$/i.test(name)).sort();
  const metadata = await readMetadata(root, names);
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
    const details = Object.hasOwn(metadata, id) ? metadata[id] : undefined;
    manifest.push({ id, filename, url: `generated/scores/${encodeURIComponent(asset)}`, ...details });
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
