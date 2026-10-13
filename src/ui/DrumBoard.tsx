import { useEffect, useRef } from 'react';
import type { Attempt, Target } from '../game/scoring';
import type { Hand } from '../score/model';
import type { Feedback } from './game-types';

const LOOK_AHEAD = 2;

export function DrumBoard({ targets, position, speed, preview, attempt, feedback, onTap }: {
  targets: Target[]; position: number; speed: number; preview: boolean;
  attempt?: Attempt; feedback?: Feedback; onTap: (hand: Hand, timestamp: number) => void;
}) {
  const board = useRef<HTMLDivElement>(null);
  useEffect(() => { board.current?.focus(); }, []);
  const upcoming = preview ? targets.filter(target => {
    const remaining = (target.time - position) / speed;
    return remaining <= LOOK_AHEAD && remaining >= -target.window && !attempt?.isJudged(target.id);
  }) : [];
  return <div className="drum-board" role="group" aria-label="Playable drum" tabIndex={-1} ref={board}
    onKeyDown={event => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key !== 'f' && key !== 'j') return;
      event.preventDefault();
      onTap(key === 'f' ? 'L' : 'R', event.timeStamp);
    }}>
    <div className={`drum-track${preview ? '' : ' cues-off'}`} aria-hidden="true">
      <div className="drum-lane left" /><div className="drum-lane right" />
      {preview ? upcoming.map(target => <div key={target.id}
        className={`drum-note ${target.hand === 'L' ? 'left' : target.hand === 'R' ? 'right' : 'either'}`}
        style={{ top: `${(1 - (target.time - position) / speed / LOOK_AHEAD) * 100}%` }}>
        <span>{target.hand ?? 'Either'}</span>
      </div>) : <span className="drum-memory">Cues off · Play from memory</span>}
      <div className="drum-strike-line" />
    </div>
    <div className="drum-pads" role="group" aria-label="Drum head">
      {(['L', 'R'] as const).map(hand => {
        const tapped = feedback?.strike === hand;
        const wrong = tapped && (feedback.text === 'Wrong hand' || feedback.text === 'Extra tap');
        return <button key={hand} data-hand={hand} aria-label={`Play ${hand === 'L' ? 'left' : 'right'} stick`}
          className={`drum-pad ${hand === 'L' ? 'left' : 'right'}${tapped ? wrong ? ' wrong' : ' tapped' : ''}`}
          onPointerDown={event => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            event.preventDefault();
            onTap(hand, event.timeStamp);
          }}
          onClick={event => { if (event.detail === 0) onTap(hand, event.timeStamp); }}
          onContextMenu={event => event.preventDefault()}>
          <span className="drum-pad-label">{hand === 'L' ? 'Left' : 'Right'}<small>{hand === 'L' ? 'F' : 'J'}</small></span>
        </button>;
      })}
    </div>
  </div>;
}
