import { readFileSync } from 'node:fs';
import path from 'node:path';
import { decodeArchive } from '../src/score/archive';
import { parseScore } from '../src/score/parser';

export const fixture = (id: string) => parseScore(decodeArchive(new Uint8Array(readFileSync(path.join(process.cwd(), 'scores', `${id}.mscz`)))), id);
export const chord = (duration = 'quarter', pitch = 60, extra = '', noteExtra = '') => `<Chord><durationType>${duration}</durationType>${extra}<Note><pitch>${pitch}</pitch><tpc>14</tpc>${noteExtra}</Note></Chord>`;
export const measure = (content: string, attrs = '') => `<Measure ${attrs}><voice>${content}</voice></Measure>`;
export const time = (n = 4, d = 4) => `<TimeSig><sigN>${n}</sigN><sigD>${d}</sigD></TimeSig>`;
export const tempo = (bpm: number) => `<Tempo><tempo>${bpm / 60}</tempo></Tempo>`;
export function synthetic(staffContents: string[], names = ['Piano', 'Side Drum']) {
  const parts = staffContents.map((_, i) => `<Part><Staff id="${i + 1}"><StaffType group="${i ? 'percussion' : 'pitched'}" /></Staff><trackName>${names[i]}</trackName><Instrument id="${i ? 'snare-drum' : 'piano'}"><useDrumset>${i ? 1 : 0}</useDrumset>${i ? '<Drum pitch="38"><name>Acoustic Snare</name><line>0</line></Drum>' : ''}</Instrument></Part>`).join('');
  return `<museScore version="4.70"><Score><Division>480</Division>${parts}${staffContents.map((s, i) => `<Staff id="${i + 1}">${s}</Staff>`).join('')}</Score></museScore>`;
}
