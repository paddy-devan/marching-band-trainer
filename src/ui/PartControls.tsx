import { useState } from 'react';
import type { Mix } from '../audio/transport';
import type { Part } from '../score/model';
import { Slider } from './Slider';
import { DEFAULT_PRACTICE_SETTINGS } from './practice-settings';

const DEFAULT_PART_MIX = { muted: false, solo: false };
type Props = {
  parts: Part[];
  mix: Mix;
  onPartMix: (id: string, settings: Mix[string]) => void;
  metronomeEnabled: boolean;
  metronomeVolume: number;
  onMetronomeVolume: (volume: number) => void;
};

function MixerVolume({ id, name, volume, disabled, onChange }: {
  id: string;
  name: string;
  volume: number;
  disabled?: boolean;
  onChange: (volume: number) => void;
}) {
  const percent = Math.round(volume * 100);
  return <div className="part-volume">
    <Slider id={id} min={0} max={100} step="1" aria-label={`${name} volume`} aria-valuetext={`${percent} percent`}
      value={percent} disabled={disabled} onChange={e => onChange(Number(e.target.value) / 100)} />
    <output htmlFor={id}>{percent}%</output>
  </div>;
}

export function PartControls({ parts, mix, onPartMix, metronomeEnabled, metronomeVolume, onMetronomeVolume }: Props) {
  const hasAdjustments = metronomeVolume !== DEFAULT_PRACTICE_SETTINGS.metronomeVolume || parts.some(({ id }) => {
    const settings = mix[id];
    return settings && (settings.muted || settings.solo || (settings.volume ?? 1) !== 1);
  });
  const [expanded, setExpanded] = useState(hasAdjustments);
  const toggle = (id: string, field: 'muted' | 'solo') => onPartMix(id, { ...(mix[id] ?? DEFAULT_PART_MIX), [field]: !mix[id]?.[field] });
  return <section className="part-controls" aria-label="Audio mixer">
    <details open={hasAdjustments || expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary className="mixer-heading" aria-disabled={hasAdjustments || undefined}
        onClick={event => { if (hasAdjustments) event.preventDefault(); }}>
        <h3 className="parts-heading">Audio mixer</h3>
        {hasAdjustments ? null : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>}
      </summary>
      <p className="sr-only">M mutes a part. S solos a part. Adjust each part's volume with its slider.</p>
    <div className="part-table">
      {parts.map(part => <div className="part-row" key={part.id} data-muted={!!mix[part.id]?.muted}>
        <strong>{part.name}</strong>
        <MixerVolume id={`volume-${part.id}`} name={part.name} volume={mix[part.id]?.volume ?? 1}
          onChange={volume => onPartMix(part.id, { ...(mix[part.id] ?? DEFAULT_PART_MIX), volume })} />
        <div className="part-actions">
          <button aria-label={`Mute ${part.name}`} title={`Mute ${part.name}`} aria-pressed={!!mix[part.id]?.muted} className={`mix-button ${mix[part.id]?.muted ? 'is-muted' : ''}`} onClick={() => toggle(part.id, 'muted')}>M</button>
          <button aria-label={`Solo ${part.name}`} title={`Solo ${part.name}`} aria-pressed={!!mix[part.id]?.solo} className="mix-button" onClick={() => toggle(part.id, 'solo')}>S</button>
        </div>
      </div>)}
      <div className="part-row" data-disabled={!metronomeEnabled}>
        <strong>Metronome</strong>
        <MixerVolume id="volume-metronome" name="Metronome" volume={metronomeVolume}
          disabled={!metronomeEnabled} onChange={onMetronomeVolume} />
      </div>
    </div>
    </details>
  </section>;
}
