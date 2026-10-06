import { add, compare, fraction, key, mul, nativeFraction, sub, ZERO, type Fraction } from './fraction';
import { applyConfig, type TrainerConfig } from './config';
import type { Hand, Measure, Part, Score, Signature, TieLocation, WrittenNote } from './model';
import { child, children, number, parseXml, text } from './xml';

const slug = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part';
const durations: Record<string, Fraction> = {
  longa: fraction(16), breve: fraction(8), whole: fraction(4), half: fraction(2), quarter: fraction(1),
  eighth: fraction(1, 2), '16th': fraction(1, 4), '32nd': fraction(1, 8), '64th': fraction(1, 16),
  '128th': fraction(1, 32), '256th': fraction(1, 64), '512th': fraction(1, 128), '1024th': fraction(1, 256),
};
function duration(el: Element, measure: Measure): Fraction {
  const type = text(el, 'durationType');
  if (type === 'measure') return text(el, 'duration') ? nativeFraction(text(el, 'duration')) : measure.duration;
  const base = durations[type];
  if (!base) throw new Error(`Bar ${measure.index + 1}: unsupported duration “${type || 'missing'}”.`);
  const dots = number(el, 'dots');
  if (!Number.isInteger(dots) || dots < 0 || dots > 4) throw new Error('Invalid dotted duration.');
  return mul(base, fraction(2 ** (dots + 1) - 1, 2 ** dots));
}
function location(el: Element | undefined): TieLocation | undefined {
  const loc = el && child(el, 'location');
  if (!loc) return;
  return {
    measures: number(loc, 'measures'), fraction: text(loc, 'fractions') ? nativeFraction(text(loc, 'fractions')) : ZERO,
    voices: number(loc, 'voices'), staves: number(loc, 'staves'),
  };
}
const signatureOf = (el: Element): Signature => ({ numerator: number(el, 'sigN'), denominator: number(el, 'sigD') });

export function parseScore(xml: string, id: string, customConfig?: TrainerConfig): Score {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  if (root.localName !== 'museScore') throw new Error('This is not a MuseScore document.');
  const version = root.getAttribute('version') || '';
  if (!/^4\.\d+$/.test(version)) throw new Error(`MuseScore format ${version || 'unknown'} is unsupported. Use a MuseScore 4 score.`);
  const node = child(root, 'Score');
  if (!node) throw new Error('Master score is missing.');
  const warnings: string[] = [];
  const warn = (message: string) => { if (!warnings.includes(message)) warnings.push(message); };
  if (version !== '4.70') warn(`MuseScore ${version}: only format 4.70 has been verified with the supplied fixtures.`);
  const division = number(node, 'Division', 480);
  if (!Number.isFinite(division) || division <= 0) throw new Error('Invalid score tick division.');
  const metadata = new Map(children(node, 'metaTag').map(e => [e.getAttribute('name'), text(e)]));
  const visible = (style: string) => Array.from(node.getElementsByTagName('Text')).find(e => text(e, 'style').toLowerCase() === style);
  const title = text(visible('title'), 'text') || metadata.get('workTitle') || id.replace(/[-_]/g, ' ');
  const composerText = text(visible('composer'), 'text') || metadata.get('composer');
  const composer = composerText && !/^(composer|traditional)$/i.test(composerText) ? composerText : undefined;

  const staffs = children(node, 'Staff');
  if (!staffs.length) throw new Error('The score has no staffs.');
  const staffIds = staffs.map((s, i) => s.getAttribute('id') || String(i + 1));
  if (new Set(staffIds).size !== staffIds.length) throw new Error('Duplicate staff identifiers.');
  let ordinal = 0;
  const usedIds = new Map<string, number>();
  const parts: Part[] = children(node, 'Part').map((p, i) => {
    const instrument = child(p, 'Instrument');
    const instrumentId = instrument?.getAttribute('id') || 'unknown';
    const name = text(p, 'trackName') || text(instrument, 'longName') || `Part ${i + 1}`;
    const definitions = children(p, 'Staff');
    const ids = definitions.map(s => {
      const fallback = staffIds[ordinal++];
      return s.getAttribute('id') || fallback;
    });
    if (ids.some(s => !s || !staffIds.includes(s))) throw new Error(`Cannot resolve staffs for ${name}.`);
    const percussion = number(instrument || p, 'useDrumset') === 1 || definitions.some(s => child(s, 'StaffType')?.getAttribute('group') === 'percussion');
    const drums: Part['drums'] = {};
    for (const d of instrument ? children(instrument, 'Drum') : []) {
      const pitch = Number(d.getAttribute('pitch'));
      const drumName = text(d, 'name');
      const hand: Hand | undefined = /\bleft\b/i.test(drumName) ? 'L' : /\bright\b/i.test(drumName) ? 'R' : undefined;
      drums[pitch] = { pitch, name: drumName, line: text(d, 'line') ? number(d, 'line') : undefined, hand };
    }
    const baseId = `${id}:${slug(name)}:${slug(instrumentId)}`;
    const duplicate = usedIds.get(baseId) || 0;
    usedIds.set(baseId, duplicate + 1);
    if (duplicate) warn(`Duplicate part name “${name}”: configure parts with an unambiguous instrument selector.`);
    return {
      id: duplicate ? `${baseId}:${duplicate + 1}` : baseId, name, instrument: instrumentId, staffIds: ids,
      percussion, drums, renderer: /bell lyre|glockenspiel/i.test(name) ? 'lyre' : /snare|side drum/i.test(name + instrumentId) ? 'snare' : 'pulse',
      register: { min: 81, max: 105, transpose: /bell lyre/i.test(name) ? 24 : 0, provisional: true },
      rollProfile: 'repertoire',
    };
  });
  if (!parts.length) throw new Error('The score has no part definitions.');
  const ownership = new Map<string, Part>();
  for (const p of parts) for (const sid of p.staffIds) {
    if (ownership.has(sid)) throw new Error(`Staff ${sid} belongs to more than one part.`);
    ownership.set(sid, p);
  }
  if (staffIds.some(sid => !ownership.has(sid))) throw new Error('A score staff has no matching part definition.');
  applyConfig(id, parts, warnings, customConfig);

  const all = Array.from(node.getElementsByTagName('*'));
  if (all.some(e => ['startRepeat', 'endRepeat', 'Jump', 'Marker', 'RepeatMeasure'].includes(e.localName) || (e.localName === 'Spanner' && e.getAttribute('type') === 'Volta')))
    warn('Repeats, endings and jumps are not expanded. Playback follows the written bars once, in order.');
  if (all.some(e => e.localName === 'Tuplet')) warn('Tuplets are not interpreted yet; their written durations are approximate.');
  if (all.some(e => /grace|acciaccatura|appoggiatura/i.test(e.localName))) warn('Grace notes are omitted from playback.');
  if (all.some(e => ['InstrumentChange', 'Ottava', 'TremoloTwoChord', 'MeasureRepeat'].includes(e.localName) || (e.localName === 'Spanner' && e.getAttribute('type') === 'Ottava')))
    warn('Instrument changes, octave spanners, two-chord tremolos and measure repeats are not interpreted. Stored pitches play as written.');
  const staffMeasures = staffs.map(s => children(s, 'Measure'));
  const count = Math.max(...staffMeasures.map(ms => ms.length));
  if (!count) throw new Error('The score has no measures.');
  if (staffMeasures.some(ms => ms.length !== count)) warn('Staff measure counts differ; missing measures are treated as silence. Multimeasure-rest compression is not expanded.');
  const measures: Measure[] = [];
  let signature: Signature = { numerator: 4, denominator: 4 };
  let position = ZERO;
  const signatures: Score['signatures'] = [];
  for (let i = 0; i < count; i++) {
    const marks = staffMeasures.flatMap(ms => ms[i] ? Array.from(ms[i].getElementsByTagName('TimeSig')) : []);
    if (marks.length) {
      const next = signatureOf(marks[0]);
      if (!Number.isInteger(next.numerator) || next.numerator <= 0 || ![1, 2, 4, 8, 16, 32, 64].includes(next.denominator)) throw new Error(`Bar ${i + 1}: invalid time signature.`);
      if (marks.some(e => JSON.stringify(signatureOf(e)) !== JSON.stringify(next))) warn(`Bar ${i + 1}: conflicting staff time signatures; using the first.`);
      signature = next;
    }
    if (!i || JSON.stringify(signatures.at(-1)?.signature) !== JSON.stringify(signature)) signatures.push({ position, signature });
    const explicit = staffMeasures.map(ms => ms[i]?.getAttribute('len')).find(Boolean);
    const length = explicit ? nativeFraction(explicit) : fraction(signature.numerator * 4, signature.denominator);
    if (compare(length, ZERO) <= 0) throw new Error(`Bar ${i + 1}: invalid measure length.`);
    measures.push({ index: i, start: position, duration: length, signature });
    position = add(position, length);
  }
  const notes: WrittenNote[] = [];
  const rests: Score['rests'] = [];
  const tempos: Score['tempos'] = [];
  const keys: Score['keys'] = [];
  staffs.forEach((staff, staffIndex) => {
    const sid = staffIds[staffIndex];
    const part = ownership.get(sid)!;
    const staffDefinition = children(children(node, 'Part')[parts.indexOf(part)], 'Staff')[part.staffIds.indexOf(sid)];
    const group = child(staffDefinition, 'StaffType')?.getAttribute('group');
    const percussion = group ? group === 'percussion' : part.percussion;
    staffMeasures[staffIndex].forEach((measureNode, mi) => {
      const measure = measures[mi];
      children(measureNode, 'voice').forEach((voiceNode, vi) => {
        let cursor = ZERO;
        const sticking = new Map<string, Hand>();
        const voiceNotes: WrittenNote[] = [];
        for (const el of Array.from(voiceNode.children)) {
          const at = add(measure.start, cursor);
          switch (el.localName) {
            case 'location': {
              if (text(el, 'fractions')) cursor = add(cursor, nativeFraction(text(el, 'fractions')));
              if (number(el, 'measures')) warn(`${part.name}: cross-measure voice locations are unsupported.`);
              break;
            }
            case 'tick': {
              const tick = Number(text(el));
              if (!Number.isSafeInteger(tick)) throw new Error('Invalid voice tick.');
              cursor = sub(fraction(tick, division), measure.start);
              break;
            }
            case 'Sticking': {
              const mark = text(el, 'text').toUpperCase();
              if (mark === 'R' || mark === 'L') {
                if (sticking.has(key(cursor)) && sticking.get(key(cursor)) !== mark) warn(`${part.name}: conflicting sticking at bar ${mi + 1}.`);
                sticking.set(key(cursor), mark);
              } else warn(`${part.name}: sticking “${mark}” at bar ${mi + 1} is unsupported; use a single R or L.`);
              break;
            }
            case 'Tempo': {
              const bpm = number(el, 'tempo') * 60;
              if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 1000) throw new Error(`Bar ${mi + 1}: invalid playback tempo.`);
              const existing = tempos.find(t => compare(t.position, at) === 0);
              if (!existing) tempos.push({ position: at, bpm });
              else if (Math.abs(existing.bpm - bpm) > 0.01) warn(`Bar ${mi + 1}: conflicting tempo marks; using the first.`);
              break;
            }
            case 'KeySig': {
              if (!percussion) {
                const fifths = number(el, 'concertKey', number(el, 'accidental'));
                if (!Number.isInteger(fifths) || Math.abs(fifths) > 7) warn(`${part.name}: unsupported key signature at bar ${mi + 1}.`);
                else keys.push({ partId: part.id, position: at, fifths, mode: text(el, 'mode') || undefined });
              }
              break;
            }
            case 'TimeSig': {
              if (compare(cursor, ZERO) !== 0) warn(`Bar ${mi + 1}: mid-bar time-signature changes are unsupported.`);
              break;
            }
            case 'Chord':
            case 'Rest': {
              if (Array.from(el.children).some(c => /grace|acciaccatura|appoggiatura/i.test(c.localName))) break;
              const length = duration(el, measure);
              if (el.localName === 'Rest') rests.push({ partId: part.id, position: at, duration: length, voice: vi });
              else {
                const tremolo = child(el, 'TremoloSingleChord');
                const accent = Array.from(el.getElementsByTagName('Articulation')).some(e => /accent|marcato/i.test(text(e, 'subtype')));
                for (const [ni, n] of children(el, 'Note').entries()) {
                  const pitch = number(n, 'pitch', -1);
                  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) throw new Error(`${part.name}, bar ${mi + 1}: invalid note pitch.`);
                  const spanners = children(n, 'Spanner').filter(e => e.getAttribute('type') === 'Tie');
                  // A middle note may end one tie and start another in separate spanners.
                  const nextTie = spanners.find(e => child(e, 'next'));
                  const previousTie = spanners.find(e => child(e, 'prev'));
                  const note: WrittenNote = {
                    id: `${part.id}:${sid}:${mi}:${vi}:${key(cursor)}:${ni}`, partId: part.id, staffId: sid,
                    voice: vi, measure: mi, offset: cursor, position: at, duration: length, pitch,
                    tpc: text(n, 'tpc') ? number(n, 'tpc') : undefined, percussion,
                    provenance: 'unknown', tremolo: tremolo ? text(tremolo, 'subtype') : undefined,
                    velocity: accent ? 1 : 0.72,
                    tieNext: location(nextTie && child(nextTie, 'next')), tiePrev: location(previousTie && child(previousTie, 'prev')),
                  };
                  voiceNotes.push(note);
                  notes.push(note);
                }
              }
              cursor = add(cursor, length);
              break;
            }
          }
        }
        if (compare(cursor, measure.duration) > 0) warn(`${part.name}, bar ${mi + 1}: voice exceeds the measure; playback may overlap the next bar.`);
        for (const n of voiceNotes) {
          if (!n.percussion) continue;
          const explicit = sticking.get(key(n.offset));
          const drum = part.drums[n.pitch];
          const configured = drum?.line !== undefined && drum.line !== 0 && part.positionHands
            ? (drum.line < 0 ? part.positionHands.upper : part.positionHands.lower) : undefined;
          n.hand = explicit || drum?.hand || configured;
          n.provenance = explicit ? 'explicit' : drum?.hand ? 'drum-map' : configured ? 'configured' : 'unknown';
          if (explicit && drum?.hand && explicit !== drum.hand) warn(`${part.name}: explicit sticking overrides a conflicting named drum mapping.`);
        }
      });
    });
  });
  notes.sort((a, b) => compare(a.position, b.position));
  tempos.sort((a, b) => compare(a.position, b.position));
  if (!tempos.length || compare(tempos[0].position, ZERO) > 0) {
    tempos.unshift({ position: ZERO, bpm: 120 });
    warn('No initial playback tempo was found; using 120 BPM until the first tempo mark.');
  }
  const ties: Score['ties'] = [];
  const destination = (source: WrittenNote, loc: TieLocation) => {
    const mi = source.measure + loc.measures;
    if (!measures[mi]) return [];
    const target = add(measures[mi].start, add(source.offset, loc.fraction));
    const targetStaff = staffIds[staffIds.indexOf(source.staffId) + loc.staves];
    return notes.filter(n => n.staffId === targetStaff && n.voice === source.voice + loc.voices && n.pitch === source.pitch && compare(n.position, target) === 0);
  };
  for (const n of notes) if (n.tieNext) {
    const candidates = destination(n, n.tieNext);
    const target = candidates[0];
    if (candidates.length !== 1 || !target || target.partId !== n.partId || compare(add(n.position, n.duration), target.position) !== 0) {
      warn(`${parts.find(p => p.id === n.partId)?.name}, bar ${n.measure + 1}: unresolved or non-contiguous tie; notes play separately.`);
      continue;
    }
    if (target.tiePrev && !destination(target, target.tiePrev).some(prev => prev.id === n.id)) {
      warn(`Bar ${n.measure + 1}: inconsistent tie endpoints; notes play separately.`);
      continue;
    }
    if (ties.some(t => t.to === target.id)) { warn(`Bar ${n.measure + 1}: ambiguous tie continuation; notes play separately.`); continue; }
    ties.push({ from: n.id, to: target.id });
  }
  for (const n of notes) if (n.tiePrev && !ties.some(t => t.to === n.id)) warn(`Bar ${n.measure + 1}: tie continuation has no resolved start.`);
  for (const part of parts.filter(p => p.renderer === 'snare')) {
    const missing = notes.filter(n => n.partId === part.id && n.percussion && !n.hand).length;
    if (missing) warn(`${part.name}: ${missing} written notes have unspecified sticking. Neutral strikes are shown; no hand is invented.`);
  }
  const end = notes.reduce((max, n) => compare(add(n.position, n.duration), max) > 0 ? add(n.position, n.duration) : max, position);
  return { id, version, title, composer, parts, measures, notes, rests, ties, tempos, keys, signatures, warnings, duration: end };
}
