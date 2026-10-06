import { decodeArchive } from './archive';
import { parseScore } from './parser';
import { interpretScore } from './interpret';
import type { CatalogueEntry, Timeline } from './model';

const cache = new Map<string, Promise<Timeline>>();
export const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path}`;
export async function loadCatalogue(): Promise<CatalogueEntry[]> {
  const response = await fetch(assetUrl('generated/catalogue.json'));
  if (!response.ok) throw new Error('Catalogue unavailable. Run npm run scores, then restart the development server.');
  return response.json();
}
export function loadScore(entry: CatalogueEntry): Promise<Timeline> {
  const existing = cache.get(entry.url);
  if (existing) return existing;
  const pending = (async () => {
    const response = await fetch(assetUrl(entry.url));
    if (!response.ok) throw new Error(`Cannot load ${entry.filename} (HTTP ${response.status}).`);
    const xml = decodeArchive(new Uint8Array(await response.arrayBuffer()));
    return interpretScore(parseScore(xml, entry.id));
  })();
  cache.set(entry.url, pending);
  pending.catch(() => cache.delete(entry.url));
  return pending;
}
