import { memo, useMemo, type CSSProperties } from 'react';
import type { Part } from '../score/model';
import { pitchLabel } from '../score/labels';
import { lyreBars } from './InstrumentView';
import type { Feedback } from './game-types';

export const LyreBoard = memo(function LyreBoard({ part, cuePitches, feedback, onTap }: { part: Part; cuePitches: Set<number>; feedback?: Feedback; onTap: (pitch: number, timestamp: number) => void }) {
  const bars = useMemo(() => {
    const bars = lyreBars(part);
    const minY = Math.min(...bars.map(b => b.y));
    const maxY = Math.max(...bars.map(b => b.y));
    const height = 100 / bars.filter(b => !b.accidental).length;
    return bars.map(bar => ({ ...bar, label: pitchLabel(bar.pitch, undefined, 'sharps'),
      style: { top: `${(bar.y - minY) / Math.max(1, maxY - minY) * (100 - height)}%`, height: `${height}%` } as CSSProperties,
    }));
  }, [part]);
  return <div className="game-board" aria-label="Playable bell lyre">
    {bars.map(bar => {
      const label = bar.label;
      const tapped = feedback?.strike === bar.pitch;
      const wrong = tapped && (feedback.text === 'Wrong note' || feedback.text === 'Extra tap');
      return <button key={bar.pitch} className={`game-bar ${bar.accidental ? 'accidental' : 'natural'}${cuePitches.has(bar.pitch) ? ' cued' : ''}${tapped ? wrong ? ' wrong' : ' tapped' : ''}`} style={bar.style}
        aria-label={`Play ${label}`} data-pitch={bar.pitch}
        onPointerDown={event => { if (event.pointerType === 'mouse' && event.button !== 0) return; event.preventDefault(); onTap(bar.pitch, event.timeStamp); }}
        onClick={event => { if (event.detail === 0) onTap(bar.pitch, event.timeStamp); }}
        onContextMenu={event => event.preventDefault()}>
        <span>{label.replace(/-?\d+$/, '')}<sub>{Math.floor(bar.pitch / 12) - 1}</sub></span><span className="game-bar-dot" aria-hidden="true" />
      </button>;
    })}
  </div>;
});
