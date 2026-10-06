import { unzipSync, strFromU8 } from 'fflate';
import { parseXml } from './xml';

export function decodeArchive(bytes: Uint8Array): string {
  if (bytes.length > 20 * 1024 * 1024) throw new Error('Score archive exceeds the 20 MB limit.');
  let entries: Record<string, Uint8Array>;
  let expandedSize = 0;
  try {
    entries = unzipSync(bytes, { filter: f => {
      const wanted = /\.mscx$/i.test(f.name) || f.name === 'META-INF/container.xml';
      if (wanted) expandedSize += f.originalSize;
      if (expandedSize > 20 * 1024 * 1024) throw new Error('Score XML exceeds the size limit.');
      return wanted;
    } });
  } catch { throw new Error('Cannot open this MuseScore archive. It may be corrupt or too large.'); }
  const scores = Object.keys(entries).filter(n => /\.mscx$/i.test(n));
  const container = entries['META-INF/container.xml'];
  if (container) {
    const doc = parseXml(strFromU8(container));
    const paths = Array.from(doc.getElementsByTagName('rootfile')).map(el => el.getAttribute('full-path'));
    const listed = paths.filter((p): p is string => !!p && /\.mscx$/i.test(p));
    if (listed.length === 1) {
      if (!entries[listed[0]]) throw new Error('Archive container references a missing master score.');
      return strFromU8(entries[listed[0]]);
    }
    if (listed.length > 1) {
      const master = listed.filter(p => !p.includes('/') && !/excerpt/i.test(p));
      if (master.length === 1 && entries[master[0]]) return strFromU8(entries[master[0]]);
      throw new Error('Archive contains multiple possible master scores.');
    }
  }
  const candidates = scores.filter(n => !n.includes('/') && !/excerpt/i.test(n));
  if (candidates.length !== 1) throw new Error('Cannot identify a unique master .mscx document in the archive.');
  return strFromU8(entries[candidates[0]]);
}
